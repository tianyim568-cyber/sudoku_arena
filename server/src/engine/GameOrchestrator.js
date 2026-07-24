/**
 * GameOrchestrator — top-level coordinator for Sudoku Arena rounds.
 *
 * Replaces the monolithic GameEngine. Holds NO in-memory game state,
 * does NOT reference Socket.io directly. All state lives in
 * StateRepository; all socket emissions are returned as plain objects
 * for the caller (SocketManager / routes) to process.
 *
 * Emission format:
 *   { target: 'tournament'|'team'|'user', targetId, event, payload }
 *
 * The orchestrator delegates to Round1Engine, Round2Engine, Round3Engine
 * for round-specific logic, and uses TimerService + ScoringService
 * for cross-cutting concerns.
 */

const TimerService = require('./TimerService');
const ScoringService = require('./ScoringService');
const Round1Engine = require('./Round1Engine');
const Round2Engine = require('./Round2Engine');
const Round3Engine = require('./Round3Engine');
const PuzzleAssignmentService = require('../services/PuzzleAssignmentService');
const Round2NotificationService = require('../services/Round2NotificationService');
const Round3CollaborationService = require('../services/Round3CollaborationService');
const { TournamentError, RoundError } = require('./errors');

class GameOrchestrator {
  /**
   * @param {import('../db/index')} repos — repository factory
   * @param {import('../state/StateRepository')} state — StateRepository (Memory or Redis)
   * @param {import('../ws/EmissionBus')} bus — EmissionBus for decoupled emissions
   */
  constructor(repos, state, bus) {
    this.repos = repos;
    this.state = state;
    this.bus = bus;

    // Services
    this.timer = new TimerService(state);
    this.scoring = new ScoringService(repos.scores);
    this.puzzleAssignment = new PuzzleAssignmentService(repos);
    this.r2Notification = new Round2NotificationService();
    this.r3Collaboration = new Round3CollaborationService(repos, state, this.scoring);

    // Round engines — pass new services as 4th parameter
    this.round1 = new Round1Engine(repos, state, this.scoring, this.puzzleAssignment);
    this.round2 = new Round2Engine(repos, state, this.scoring, this.r2Notification);
    this.round3 = new Round3Engine(repos, state, this.scoring, this.r3Collaboration);

    // Set emission callback for R2 notification service to emit through the bus
    this.round2.setEmissionCallback((emission) => {
      this.bus.emitImmediate(emission);
    });
  }

  // ─── Get the right engine for a round type ────────────────────

  _getEngine(roundType) {
    switch (roundType) {
      case 'ROUND1_NINE_ONE': return this.round1;
      case 'ROUND2_RELAY': return this.round2;
      case 'ROUND3_COLLABORATE': return this.round3;
      default: throw new RoundError(`Unknown round type: ${roundType}`);
    }
  }

  // ─── Public helpers (used by routes and socket handler) ───────

  async getRemainingSeconds(roundId) {
    return this.state.getRemainingSeconds(roundId);
  }

  async getRound2TeamState(roundId, teamId) {
    return this.state.getRound2TeamState(roundId, teamId);
  }

  async getRound3Cells(puzzleId) {
    return this.state.getRound3Cells(puzzleId);
  }

  // ─── Reconnect state ──────────────────────────────────────────

  async getReconnectState(userId, tournamentId) {
    const tournament = await this.repos.tournaments.findById(tournamentId);
    if (!tournament) return null;

    const activeRound = await this.repos.tournaments.findActiveRound(tournamentId);
    if (!activeRound) return { tournamentStatus: tournament.status, currentRound: null };

    const assignments = await this.repos.playerStates.findPlayerAssignments(activeRound.id, userId);
    const remaining = await this.getRemainingSeconds(activeRound.id);

    const result = {
      tournamentStatus: tournament.status,
      currentRound: {
        roundId: activeRound.id,
        roundNumber: activeRound.round_number,
        roundName: activeRound.name,
        roundType: activeRound.round_type,
        durationSeconds: activeRound.duration_seconds,
        remainingSeconds: remaining,
        turnEndsAt: null
      },
      puzzles: assignments.map(p => {
        const isFinal = p.puzzle_type === 'FINAL';
        return {
          puzzleId: p.id, puzzleType: p.puzzle_type, orderInRound: p.order_in_round,
          initialGrid: JSON.parse(p.initial_grid),
          currentGrid: p.current_grid ? JSON.parse(p.current_grid) : null,
          points: p.points, letter: p.letter, isFinal, isLocked: isFinal
        };
      })
    };

    const timer = await this.state.getRoundTimer(activeRound.id);
    if (timer) {
      result.currentRound.turnEndsAt = timer.turnEndsAt;
      result.currentRound.timerStatus = timer.status;
    }

    // Delegate to round engine for round-specific reconnect state
    const engine = this._getEngine(activeRound.round_type);
    const roundState = await engine.getReconnectState(userId, tournamentId, activeRound.id);

    if (activeRound.round_type === 'ROUND1_NINE_ONE' && roundState) {
      result.round1Progress = roundState;
      // Unlock final puzzle in the puzzles list if needed
      if (roundState.finalUnlocked) {
        const finalPuzzle = result.puzzles.find(p => p.puzzleId === roundState.finalPuzzleId);
        if (finalPuzzle) finalPuzzle.isLocked = false;
      }
    } else if (activeRound.round_type === 'ROUND2_RELAY' && roundState) {
      result.round2State = roundState;
    } else if (activeRound.round_type === 'ROUND3_COLLABORATE' && roundState) {
      result.round3State = roundState;
    }

    return result;
  }

  // ─── Tournament lifecycle ─────────────────────────────────────

  async startTournament(tournamentId) {
    const t = await this.repos.tournaments.findById(tournamentId);
    if (!t) throw new TournamentError('比赛不存在');
    if (t.status !== 'PENDING' && t.status !== 'READY') throw new TournamentError('比赛状态不允许开始');

    const rounds = await this.repos.rounds.findByTournament(tournamentId);
    if (rounds.length < 3) throw new TournamentError('轮次配置不完整');
    const teams = await this.repos.teams.findByTournament(tournamentId);
    if (teams.length === 0) throw new TournamentError('没有队伍');

    await this.repos.tournaments.updateStatus(tournamentId, 'IN_PROGRESS');

    const emissions = [{
      target: 'tournament', targetId: tournamentId, event: 'TOURNAMENT_STARTED',
      payload: {
        tournamentName: t.name, totalRounds: rounds.length,
        teams: teams.map(tm => ({ teamId: tm.id, teamName: tm.name }))
      }
    }];

    return { result: { tournamentId, status: 'IN_PROGRESS' }, emissions };
  }

  async startRound(tournamentId, roundId) {
    const round = await this.repos.rounds.findById(roundId);
    if (!round || round.tournament_id !== tournamentId) throw new RoundError('轮次不存在');
    if (round.status !== 'NOT_STARTED') throw new RoundError('轮次状态不允许开始');

    const tournament = await this.repos.tournaments.findById(tournamentId);
    if (tournament.status !== 'IN_PROGRESS') throw new TournamentError('比赛未在进行中');

    await this.repos.rounds.startRound(roundId, round.duration_seconds);

    // Start timer
    const { turnEndsAt } = await this.timer.start(roundId, round.duration_seconds);

    const teams = await this.repos.teams.findByTournament(tournamentId);
    const puzzles = await this.repos.puzzles.findByRound(roundId);

    // Broadcast round started
    const emissions = [{
      target: 'tournament', targetId: tournamentId, event: 'ROUND_STARTED',
      payload: {
        roundId, roundNumber: round.round_number, roundName: round.name,
        roundType: round.round_type, durationSeconds: round.duration_seconds,
        totalPuzzles: puzzles.length, turnEndsAt
      }
    }];

    // Delegate setup to round engine
    const engine = this._getEngine(round.round_type);
    const setupResult = await engine.setup(tournamentId, roundId, teams, puzzles);
    emissions.push(...setupResult.emissions);

    // Start timer tick interval — broadcast every ~10s for recalibration
    this.timer.startTickInterval(roundId, round.duration_seconds,
      (remaining, timerState, shouldBroadcast) => {
        if (shouldBroadcast) {
          this.bus.emitImmediate({
            target: 'tournament', targetId: tournamentId, event: 'TIMER_TICK',
            payload: {
              roundId, remainingSeconds: remaining,
              totalSeconds: timerState?.durationSeconds || round.duration_seconds,
              turnEndsAt: timerState?.turnEndsAt || 0
            }
          });
        }
      },
      () => {
        // Timer expired — end the round
        this.endRound(tournamentId, roundId);
      }
    );

    // Start R2 rotation intervals
    if (round.round_type === 'ROUND2_RELAY') {
      this.round2.startRotationIntervals(tournamentId, roundId, teams, (tid, rid, teamId) => {
        this._handleRotation(tid, rid, teamId);
      });
    }

    return {
      result: { roundId, status: 'IN_PROGRESS', startedAt: new Date().toISOString(), durationSeconds: round.duration_seconds, turnEndsAt },
      emissions
    };
  }

  // ─── Rotation handler (called by interval) ────────────────────

  async _handleRotation(tournamentId, roundId, teamId) {
    const { emissions } = await this.round2.rotatePuzzles(tournamentId, roundId, teamId);
    this.bus.emitAll(emissions);
  }

  // ─── Pause / Resume ──────────────────────────────────────────

  async pauseTournament(tournamentId) {
    const t = await this.repos.tournaments.findById(tournamentId);
    if (!t || t.status !== 'IN_PROGRESS') throw new TournamentError('比赛状态不允许暂停');

    const emissions = [];
    const currentRound = await this.repos.rounds.findByTournamentAndStatus(tournamentId, 'IN_PROGRESS');

    if (currentRound) {
      this.timer.clearTickInterval(currentRound.id);
      await this.timer.pause(currentRound.id);

      // Clear R2 rotation intervals
      if (currentRound.round_type === 'ROUND2_RELAY') {
        const teams = await this.repos.teams.findByTournament(tournamentId);
        this.round2.clearRotationIntervals(currentRound.id, teams);
      }

      const remaining = await this.timer.getRemainingSeconds(currentRound.id);
      await this.repos.rounds.pauseRound(currentRound.id, remaining);
    }

    await this.repos.tournaments.updateStatus(tournamentId, 'PAUSED');

    emissions.push({
      target: 'tournament', targetId: tournamentId, event: 'TOURNAMENT_PAUSED',
      payload: {
        tournamentId,
        timerStatus: 'PAUSED',
        turnEndsAt: null,
        remainingAtPause: currentRound ? await this.state.getRemainingSeconds(currentRound.id) : 0
      }
    });
    return { result: { tournamentId, status: 'PAUSED' }, emissions };
  }

  async resumeTournament(tournamentId) {
    const t = await this.repos.tournaments.findById(tournamentId);
    if (!t || t.status !== 'PAUSED') throw new TournamentError('比赛状态不允许恢复');

    const emissions = [];
    const currentRound = await this.repos.rounds.findByTournamentAndStatus(tournamentId, 'PAUSED');

    if (currentRound) {
      const timerResult = await this.timer.resume(currentRound.id);
      await this.repos.rounds.resumeRound(currentRound.id);

      // Restart timer tick interval — broadcast every ~10s for recalibration
      this.timer.startTickInterval(currentRound.id, timerResult?.durationSeconds || currentRound.duration_seconds,
        (remaining, timerState, shouldBroadcast) => {
          if (shouldBroadcast) {
            this.bus.emitImmediate({
              target: 'tournament', targetId: tournamentId, event: 'TIMER_TICK',
              payload: {
                roundId: currentRound.id, remainingSeconds: remaining,
                totalSeconds: timerState?.durationSeconds || currentRound.duration_seconds,
                turnEndsAt: timerState?.turnEndsAt || 0
              }
            });
          }
        },
        () => { this.endRound(tournamentId, currentRound.id); }
      );

      // Restart R2 rotation intervals
      if (currentRound.round_type === 'ROUND2_RELAY') {
        const teams = await this.repos.teams.findByTournament(tournamentId);
        for (const team of teams) {
          // Reset nextRotationAt
          const nextRotationAt = Date.now() + 60000;
          await this.state.setRound2NextRotation(currentRound.id, team.id, nextRotationAt);
        }
        this.round2.startRotationIntervals(tournamentId, currentRound.id, teams, (tid, rid, teamId) => {
          this._handleRotation(tid, rid, teamId);
        });
      }
    }

    await this.repos.tournaments.updateStatus(tournamentId, 'IN_PROGRESS');

    emissions.push({
      target: 'tournament', targetId: tournamentId, event: 'TOURNAMENT_RESUMED',
      payload: {
        tournamentId,
        timerStatus: 'RUNNING',
        turnEndsAt: timerResult?.turnEndsAt,
        durationSeconds: currentRound?.duration_seconds
      }
    });
    return { result: { tournamentId, status: 'IN_PROGRESS' }, emissions };
  }

  // ─── End round ────────────────────────────────────────────────

  async endRound(tournamentId, roundId) {
    const round = await this.repos.rounds.findById(roundId);
    if (!round || round.status === 'FINISHED') throw new RoundError('轮次状态不允许结束');

    const emissions = [];

    // Get remaining before cleanup
    const remaining = await this.timer.getRemainingSeconds(roundId);

    // Clean up timer
    await this.timer.cleanup(roundId);

    // Round-specific cleanup
    const engine = this._getEngine(round.round_type);
    await engine.cleanup(tournamentId, roundId);

    // Round 1 time bonus
    if (round.round_type === 'ROUND1_NINE_ONE') {
      const bonusEmissions = await this.round1.applyTimeBonuses(tournamentId, roundId, remaining);
      emissions.push(...bonusEmissions);
    }

    // Round 3 completion bonus
    if (round.round_type === 'ROUND3_COLLABORATE') {
      const teams = await this.repos.teams.findByTournament(tournamentId);
      for (const team of teams) {
        const solvedPuzzleIds = await this.repos.submissions.findSolvedPuzzleIds(roundId, team.id);
        const teamPuzzles = await this.repos.puzzles.findByRoundAndTeam(roundId, team.id);
        const completionBonus = this.scoring.applyRound3CompletionBonus(
          tournamentId, roundId, team.id, remaining, solvedPuzzleIds.length, teamPuzzles.length
        );
        if (completionBonus > 0) {
          const teamScore = this.scoring.findTeamScore(tournamentId, roundId, team.id);
          emissions.push({
            target: 'team', targetId: { tournamentId, teamId: team.id }, event: 'SCORE_UPDATE',
            payload: {
              roundId, teamId: team.id, teamName: team.name,
              teamTotalPoints: teamScore?.total_points || 0,
              completionBonus, bonusMinutes: Math.floor(remaining / 60)
            }
          });
        }
      }
    }

    await this.repos.rounds.finishRound(roundId);

    emissions.push({ target: 'tournament', targetId: tournamentId, event: 'ROUND_FINISHED', payload: { roundId, roundName: round.name, roundNumber: round.round_number } });
    return { result: { roundId, status: 'FINISHED' }, emissions };
  }

  // ─── End tournament ───────────────────────────────────────────

  async endTournament(tournamentId) {
    const t = await this.repos.tournaments.findById(tournamentId);
    if (!t || t.status === 'FINISHED') throw new TournamentError('比赛状态不允许结束');

    // Business rule: all rounds must be FINISHED before tournament can end
    const activeRounds = await this.repos.rounds.findByTournamentNotStatus(tournamentId, 'FINISHED');
    if (activeRounds && activeRounds.length > 0) {
      throw new TournamentError('所有轮次必须完成后才能结束比赛');
    }

    const emissions = [];
    await this.repos.tournaments.updateStatus(tournamentId, 'FINISHED');
    emissions.push({ target: 'tournament', targetId: tournamentId, event: 'TOURNAMENT_FINISHED', payload: { tournamentId } });
    return { result: { tournamentId, status: 'FINISHED' }, emissions };
  }

  // ─── Submit answer ────────────────────────────────────────────

  async submitAnswer(userId, roundId, puzzleId, submissionType, data) {
    const round = await this.repos.rounds.findById(roundId);
    if (!round) throw new RoundError('轮次不存在');

    const engine = this._getEngine(round.round_type);
    const { result, emissions } = await engine.submitAnswer(userId, round.tournament_id, roundId, puzzleId, submissionType, data);

    return { result, emissions };
  }

  // ─── Round 2 cell update ──────────────────────────────────────

  async round2CellUpdate(userId, roundId, puzzleId, row, col, value) {
    const { result, emissions } = await this.round2.cellUpdate(userId, roundId, puzzleId, row, col, value);
    return { result, emissions };
  }

  // ─── Round 3 cell fill ────────────────────────────────────────

  async handleCellFill(userId, tournamentId, roundId, puzzleId, row, col, value) {
    // In R3, cell_fill becomes a proposal (suggestion-based workflow)
    const round = await this.repos.rounds.findById(roundId);
    if (round?.round_type === 'ROUND3_COLLABORATE' && this.r3Collaboration) {
      const playerName = await this.repos.users.getDisplayName(userId);
      const teamId = await this.repos.teams.findTeamForPlayerInRound(roundId, userId);
      const { suggestion, emissions } = await this.round3.handleCellPropose(
        puzzleId, row, col, value, userId, playerName, teamId, roundId
      );
      return { result: { success: !!suggestion, suggestion }, emissions };
    }
    // Fallback for non-R3 or without collaboration service
    const { result, emissions } = await this.round3.handleCellFill(userId, tournamentId, roundId, puzzleId, row, col, value);
    return { result, emissions };
  }

  // ─── Round 3 collaboration delegation ─────────────────────────

  async round3ProposeCell(userId, tournamentId, roundId, puzzleId, row, col, value) {
    const playerName = await this.repos.users.getDisplayName(userId);
    const teamId = await this.repos.teams.findTeamForPlayerInRound(roundId, userId);
    const { suggestion, emissions } = await this.round3.handleCellPropose(
      puzzleId, row, col, value, userId, playerName, teamId, roundId
    );
    return { result: { success: !!suggestion, suggestion }, emissions };
  }

  async round3AcceptProposal(userId, tournamentId, roundId, puzzleId, row, col) {
    const acceptorPlayerName = await this.repos.users.getDisplayName(userId);
    const teamId = await this.repos.teams.findTeamForPlayerInRound(roundId, userId);
    const { success, accepted, emissions } = await this.round3.handleCellAccept(
      puzzleId, row, col, userId, acceptorPlayerName, teamId, roundId, tournamentId
    );
    return { result: { success, accepted }, emissions };
  }

  async round3RejectProposal(userId, tournamentId, roundId, puzzleId, row, col) {
    const rejectorPlayerName = await this.repos.users.getDisplayName(userId);
    const teamId = await this.repos.teams.findTeamForPlayerInRound(roundId, userId);
    const { success, emissions } = await this.round3.handleCellReject(
      puzzleId, row, col, userId, rejectorPlayerName, teamId, roundId, tournamentId
    );
    return { result: { success }, emissions };
  }

  async round3WithdrawProposal(userId, tournamentId, roundId, puzzleId, row, col) {
    const teamId = await this.repos.teams.findTeamForPlayerInRound(roundId, userId);
    const { success, emissions } = await this.round3.handleCellWithdraw(
      puzzleId, row, col, userId, teamId, roundId, tournamentId
    );
    return { result: { success }, emissions };
  }

  async round3FocusUpdate(userId, tournamentId, roundId, puzzleId, row, col) {
    const playerName = await this.repos.users.getDisplayName(userId);
    const teamId = await this.repos.teams.findTeamForPlayerInRound(roundId, userId);
    const { emissions } = await this.round3.handleFocusUpdate(
      puzzleId, userId, playerName, row, col, teamId, roundId, tournamentId
    );
    return { result: { success: true }, emissions };
  }

  /**
   * Clear a player's R3 focus when they disconnect.
   * Finds the active R3 puzzle and removes the focus entry + emits update.
   */
  async clearRound3PlayerFocus(userId, tournamentId) {
    try {
      const activeRound = await this.repos.tournaments.findActiveRound(tournamentId);
      if (!activeRound || activeRound.round_type !== 'ROUND3_COLLABORATE') return;

      const member = await this.repos.teams.findMemberTeam(tournamentId, userId);
      if (!member) return;

      // Find the current puzzle for this team
      const teamPuzzles = await this.repos.puzzles.findByRoundAndTeam(activeRound.id, member.team_id);
      if (!teamPuzzles || teamPuzzles.length === 0) return;

      const currentPuzzleId = teamPuzzles[0].id;

      // Remove focus from state
      const focuses = await this.state.getRound3PlayerFocuses(currentPuzzleId);
      if (focuses && focuses[String(userId)]) {
        await this.state.setRound3PlayerFocus(currentPuzzleId, userId, null);

        // Emit focus removal to team
        const playerName = await this.repos.users.getDisplayName(userId);
        this.bus.emitAll([{
          target: 'team',
          targetId: { tournamentId, teamId: member.team_id },
          event: 'ROUND3_FOCUS_UPDATE',
          payload: { roundId: activeRound.id, puzzleId: currentPuzzleId, playerId: userId, playerName, row: null, col: null }
        }]);
      }
    } catch (_) { /* non-critical */ }
  }

  // ─── Emission processing ──────────────────────────────────────

  /**
   * Process an array of emissions through the EmissionBus.
   * Called by routes / socket handler after receiving emissions from orchestrator methods.
   * @param {Array} emissions
   */
  processEmissions(emissions) {
    if (!emissions) return;
    this.bus.emitAll(emissions);
  }

  /**
   * Process a single immediate emission through the EmissionBus.
   * @param {{target, targetId, event, payload}} emission
   */
  _emitImmediate(emission) {
    this.bus.emitImmediate(emission);
  }
}

module.exports = GameOrchestrator;
