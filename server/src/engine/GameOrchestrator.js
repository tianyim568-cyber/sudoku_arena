/**
 * GameOrchestrator — top-level coordinator for Sudoku Arena rounds.
 *
 * Replaces the monolithic GameEngine. Holds NO in-memory game state,
 * does NOT reference Socket.io directly. All state lives in
 * StateRepository; all socket emissions are returned as plain objects
 * for the caller (SocketManager / routes) to process.
 *
 * Emission format:
 *   { target: 'competition'|'team'|'user', targetId, event, payload }
 *
 * The orchestrator delegates to Round1Engine, Round2Engine, Round3Engine
 * for round-specific logic, and uses TimerService + ScoringService
 * for cross-cutting concerns.
 *
 * Database access: All queries go through Prisma Client via getPrisma().
 * No deprecated repository references (repos.competitions, repos.rounds, etc.).
 *
 * Vocabulary debt (Phase 14 of the competitions migration — option B):
 * This file, and the rest of server/src/engine/, server/src/ws/,
 * server/src/state/, and server/src/services/, still use the identifier
 * `competitionId` to mean a competition UUID (competitions.id). The
 * migration renamed the concept everywhere else (routes, repos, client);
 * here the old name was deliberately kept because this code has no unit
 * tests, and a silent rename across ~257 untested occurrences on the
 * heart of the game was judged too risky. The debt is assumed and
 * documented, not hidden. To be resolved if/when engine tests are added.
 */

const TimerService = require('./TimerService');
const ScoringService = require('./ScoringService');
const Round1Engine = require('./team/Round1Engine');
const Round2Engine = require('./team/Round2Engine');
const Round3Engine = require('./team/Round3Engine');
const IndividualRoundEngine = require('./individual/IndividualRoundEngine');
const PuzzleAssignmentService = require('../services/PuzzleAssignmentService');
const Round2NotificationService = require('../services/Round2NotificationService');
const Round3CollaborationService = require('../services/Round3CollaborationService');
const { isTeamRoundType, isIndividualRoundType } = require('./RoundTypes');
const { CompetitionError, RoundError, StageError } = require('./errors');

// Default transition delay between rounds (seconds).
// Gives clients time to show "next round" screen before preparation countdown starts.
const DEFAULT_TRANSITION_SECONDS = 5;
const { getPrisma } = require('../db/prisma');
const { StageManager } = require('./StageManager');
const { RoundManager } = require('./RoundManager');

class GameOrchestrator {
  /**
   * @param {import('../db/index')} repos — repository factory
   * @param {import('../state/StateRepository')} state — StateRepository (Memory or Redis)
   * @param {import('../ws/EmissionBus')} bus — EmissionBus for decoupled emissions
   * @param {import('./DisplayManager')} [displayManager] — optional display mode manager
   */
  constructor(repos, state, bus, displayManager = null) {
    this.repos = repos;
    this.state = state;
    this.bus = bus;
    this.displayManager = displayManager;

    // Services
    this.timer = new TimerService(state);
    this.scoring = new ScoringService(repos.scores);
    this.puzzleAssignment = new PuzzleAssignmentService(repos);
    this.r2Notification = new Round2NotificationService();
    this.r3Collaboration = new Round3CollaborationService(repos, state, this.scoring);

    // Stage-level orchestration
    this.stages = new StageManager(state, bus);

    // Round-level orchestration
    this.rounds = new RoundManager(state, bus, this.timer);

    // Round engines — pass new services as 4th parameter
    this.round1 = new Round1Engine(repos, state, this.scoring, this.puzzleAssignment);
    this.round2 = new Round2Engine(repos, state, this.scoring, this.r2Notification);
    this.round3 = new Round3Engine(repos, state, this.scoring, this.r3Collaboration);

    // Set emission callback for R2 notification service to emit through the bus
    this.round2.setEmissionCallback((emission) => {
      this.bus.emitImmediate(emission);
    });
  }

  // ─── Prisma helpers ─────────────────────────────────────────────

  /** @private Shorthand for getPrisma() */
  get _prisma() {
    return getPrisma();
  }

  /**
   * Resolve a round's competition_id via its stage.
   * @private
   * @param {string} roundId
   * @returns {Promise<string|null>} competition UUID
   */
  async _resolveCompetitionId(roundId) {
    const round = await this._prisma.rounds.findUnique({
      where: { id: roundId },
      include: { competition_stages: { select: { competition_id: true } } },
    });
    return round?.competition_stages?.competition_id || null;
  }

  // ─── Get the right engine for a round type ────────────────────

  _getEngine(roundType) {
    switch (roundType) {
      case 'ROUND1_NINE_ONE': return this.round1;
      case 'ROUND2_RELAY': return this.round2;
      case 'ROUND3_COLLABORATE': return this.round3;
      default:
        if (isIndividualRoundType(roundType)) {
          if (!this.individual) {
            this.individual = new IndividualRoundEngine(this.repos, this.state, this.scoring);
          }
          return this.individual;
        }
        throw new RoundError(`Unknown round type: ${roundType}`);
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

  async getReconnectState(userId, competitionId) {
    const competition = await this._prisma.competitions.findUnique({
      where: { id: competitionId },
    });
    if (!competition) return null;

    // Find the currently active round (IN_PROGRESS) for this competition
    const activeRound = await this._prisma.rounds.findFirst({
      where: {
        competition_stages: { competition_id: competitionId },
        status: 'IN_PROGRESS',
      },
    });

    if (!activeRound) {
      return { competitionStatus: competition.status, currentRound: null };
    }

    // Get player's session and answers for this round
    const session = await this._prisma.player_round_sessions.findUnique({
      where: {
        round_id_participant_id_unique: {
          round_id: activeRound.id,
          participant_id: userId,
        },
      },
      include: {
        puzzle_answers: {
          include: { puzzles: true },
        },
      },
    });

    const remaining = await this.getRemainingSeconds(activeRound.id);

    // Build puzzles array with auto-saved grids from state repository
    const puzzles = session ? await Promise.all(session.puzzle_answers.map(async (pa) => {
      const puzzle = pa.puzzles;
      const initialGrid = typeof puzzle.initial_grid === 'string'
        ? JSON.parse(puzzle.initial_grid) : puzzle.initial_grid;

      // Check state repository first (auto-saved moves), fall back to DB
      let currentGrid = await this.state.getIndividualPlayerGrid(activeRound.id, userId, puzzle.id);
      if (!currentGrid && pa.current_grid) {
        currentGrid = typeof pa.current_grid === 'string'
          ? JSON.parse(pa.current_grid) : pa.current_grid;
      }

      return {
        puzzleId: puzzle.id,
        puzzleType: puzzle.type,
        orderInRound: pa.progress_percentage,
        initialGrid,
        currentGrid,
        points: puzzle.score,
        letter: null,
        isFinal: puzzle.type === 'FINAL',
        isLocked: puzzle.type === 'FINAL',
      };
    })) : [];

    const result = {
      competitionStatus: competition.status,
      currentRound: {
        roundId: activeRound.id,
        roundNumber: activeRound.order_number,
        roundName: activeRound.name,
        roundType: activeRound.type,
        durationSeconds: activeRound.duration_seconds,
        remainingSeconds: remaining,
        turnEndsAt: null,
      },
      puzzles,
    };

    const timer = await this.state.getRoundTimer(activeRound.id);
    if (timer) {
      result.currentRound.turnEndsAt = timer.turnEndsAt;
      result.currentRound.timerStatus = timer.status;
    }

    // Delegate to round engine for round-specific reconnect state
    const engine = this._getEngine(activeRound.type);
    const roundState = await engine.getReconnectState(userId, competitionId, activeRound.id);

    if (activeRound.type === 'ROUND1_NINE_ONE' && roundState) {
      result.round1Progress = roundState;
      // Unlock final puzzle in the puzzles list if needed
      if (roundState.finalUnlocked) {
        const finalPuzzle = result.puzzles.find(p => p.puzzleId === roundState.finalPuzzleId);
        if (finalPuzzle) finalPuzzle.isLocked = false;
      }
    } else if (activeRound.type === 'ROUND2_RELAY' && roundState) {
      result.round2State = roundState;
    } else if (activeRound.type === 'ROUND3_COLLABORATE' && roundState) {
      result.round3State = roundState;
    } else if (isIndividualRoundType(activeRound.type) && roundState) {
      result.individualState = roundState;
    }

    return result;
  }

  // ─── Competition lifecycle ─────────────────────────────────────

  async startCompetition(competitionId) {
    const comp = await this._prisma.competitions.findUnique({
      where: { id: competitionId },
    });
    if (!comp) throw new CompetitionError('比赛不存在');
    if (!['DRAFT', 'PUBLISHED'].includes(comp.status)) throw new CompetitionError('比赛状态不允许开始');

    // Validate competition structure via StageManager
    const allStages = await this.stages.loadAllStages(competitionId);
    if (allStages.length === 0) throw new CompetitionError('赛事缺少阶段配置');

    const allRounds = allStages.flatMap(s => s.rounds);
    if (allRounds.length < 3) throw new CompetitionError('轮次配置不完整');

    // Only require teams when the competition actually has team-type stages.
    // Individual-only competitions need registered players, not teams.
    const hasTeamStages = allRounds.some(r => isTeamRoundType(r.type));

    const teams = await this._prisma.teams.findMany({
      where: { competition_id: competitionId },
    });
    if (hasTeamStages && teams.length === 0) throw new CompetitionError('没有队伍');

    // Atomic status transition: DRAFT/PUBLISHED → RUNNING.
    // updateMany with a WHERE on status ensures only one concurrent request
    // succeeds (prevents double-start TOCTOU race condition).
    const updateResult = await this._prisma.competitions.updateMany({
      where: { id: competitionId, status: { in: ['DRAFT', 'PUBLISHED'] } },
      data: { status: 'RUNNING' },
    });
    if (updateResult.count === 0) {
      throw new CompetitionError('比赛状态不允许开始 (already started or finished)');
    }

    const firstStage = await this.stages.findFirstStage(competitionId);

    const emissions = [{
      target: 'competition', targetId: competitionId, event: 'COMPETITION_STARTED',
      payload: {
        competitionName: comp.name, totalRounds: allRounds.length,
        totalStages: allStages.length,
        firstStageId: firstStage.id,
        firstStageType: firstStage.type,
        teams: teams.map(tm => ({ teamId: tm.id, teamName: tm.name })),
        hasTeamStages,
      },
    }];

    return { result: { competitionId, status: 'RUNNING', firstStageId: firstStage.id }, emissions };
  }

  /**
   * Start a stage — judge-triggered.
   * Validates competition is RUNNING, starts the stage, then auto-chains
   * into the first round's preparation countdown.
   *
   * Round succession within the stage is automatic: when a round finishes,
   * endRound() auto-starts the next round (or finishes the stage if it was the last).
   *
   * @param {string} competitionId
   * @param {string} stageId
   * @returns {Promise<{result: Object, emissions: Array}>}
   */
  async startStage(competitionId, stageId) {
    const comp = await this._prisma.competitions.findUnique({
      where: { id: competitionId },
    });
    if (!comp) throw new CompetitionError('比赛不存在');
    if (comp.status !== 'RUNNING') {
      throw new CompetitionError('比赛必须先开始才能启动阶段');
    }

    // Start the stage via StageManager
    const stageResult = await this.stages.startStage(competitionId, stageId);
    const emissions = [...stageResult.emissions];

    // Auto-chain: start first round's preparation phase
    const firstRound = await this.rounds.findFirstRound(stageId);
    if (firstRound) {
      const roundStartResult = await this.startRound(competitionId, firstRound.id);
      emissions.push(...roundStartResult.emissions);
    }

    return {
      result: { competitionId, stageId, status: 'RUNNING' },
      emissions,
    };
  }

  async startRound(competitionId, roundId) {
    // Validate competition is RUNNING
    const competition = await this._prisma.competitions.findUnique({
      where: { id: competitionId },
    });
    if (!competition || competition.status !== 'RUNNING') {
      throw new CompetitionError('比赛未在进行中');
    }

    // Get stage context
    const stageId = this.stages.getContext()?.stageId;
    if (!stageId) {
      throw new RoundError('未加载阶段上下文');
    }

    // Prepare round via RoundManager (loads round data, sets lifecycle to PREPARATION)
    await this.rounds.prepareRound(competitionId, stageId, roundId);

    const emissions = [];

    // Start preparation phase (countdown timer)
    const prepResult = await this.rounds.startPreparation(competitionId, async () => {
      // Preparation countdown ended — activate round and start gameplay
      const activateResult = await this._activateAndStartRound(competitionId, roundId);
      this.bus.emitAll(activateResult.emissions);
    });

    emissions.push(...prepResult.emissions);

    return { result: prepResult.result, emissions };
  }

  /**
   * Internal: Activate round and start gameplay after preparation ends.
   * Called automatically when preparation countdown expires.
   * @private
   */
  async _activateAndStartRound(competitionId, roundId) {
    const emissions = [];

    // Activate round (transitions PREPARATION → ROUND_ACTIVE, updates DB)
    const activateResult = await this.rounds.activateRound();
    emissions.push(...activateResult.emissions);

    // Get teams for engine setup
    const teams = await this._prisma.teams.findMany({
      where: { competition_id: competitionId },
    });

    // Delegate setup to round engine
    const engine = this._getEngine(this.rounds.getRoundType());
    const puzzlesForEngine = this.rounds.getPuzzlesForEngine();
    const setupResult = await engine.setup(competitionId, roundId, teams, puzzlesForEngine);
    emissions.push(...setupResult.emissions);

    // Start gameplay timer (after engine setup)
    const { turnEndsAt } = await this.rounds.startGameplayTimer(competitionId, (compId, rId) => {
      this.endRound(compId, rId);
    });

    // Start R2 rotation intervals
    if (this.rounds.getRoundType() === 'ROUND2_RELAY') {
      this.round2.startRotationIntervals(competitionId, roundId, teams, (tid, rid, teamId) => {
        this._handleRotation(tid, rid, teamId);
      });
    }

    return { turnEndsAt, emissions };
  }

  // ─── Rotation handler (called by interval) ────────────────────

  async _handleRotation(competitionId, roundId, teamId) {
    const { emissions } = await this.round2.rotatePuzzles(competitionId, roundId, teamId);
    this.bus.emitAll(emissions);
  }

  // ─── Pause / Resume ──────────────────────────────────────────

  async pauseCompetition(competitionId) {
    const comp = await this._prisma.competitions.findUnique({
      where: { id: competitionId },
    });
    if (!comp) throw new CompetitionError('比赛不存在');
    if (comp.status !== 'RUNNING') throw new CompetitionError('比赛状态不允许暂停');

    const emissions = [];

    // Find active round and pause it via RoundManager
    const activeRound = await this.rounds.findActiveRound(competitionId);

    if (activeRound) {
      // Load round context if not already loaded
      const stageId = this.stages.getContext()?.stageId;
      if (stageId) {
        await this.rounds.prepareRound(competitionId, stageId, activeRound.id);

        // Clear R2 rotation intervals before pausing
        if (activeRound.type === 'ROUND2_RELAY') {
          const teams = await this._prisma.teams.findMany({
            where: { competition_id: competitionId },
          });
          this.round2.clearRotationIntervals(activeRound.id, teams);
        }

        // Pause round (updates DB, pauses timer, emits ROUND_PAUSED)
        const pauseResult = await this.rounds.pauseRound();
        emissions.push(...pauseResult.emissions);
      }
    }

    // Atomic competition status transition: RUNNING → PAUSED
    const updateResult = await this._prisma.competitions.updateMany({
      where: { id: competitionId, status: 'RUNNING' },
      data: { status: 'PAUSED' },
    });
    if (updateResult.count === 0) {
      throw new CompetitionError('比赛状态不允许暂停 (already paused or state changed)');
    }

    emissions.push({
      target: 'competition', targetId: competitionId, event: 'COMPETITION_PAUSED',
      payload: { competitionId },
    });

    return { result: { competitionId, status: 'PAUSED' }, emissions };
  }

  async resumeCompetition(competitionId) {
    const comp = await this._prisma.competitions.findUnique({
      where: { id: competitionId },
    });
    if (!comp) throw new CompetitionError('比赛不存在');
    if (comp.status !== 'PAUSED') throw new CompetitionError('比赛状态不允许恢复');

    const emissions = [];

    // Find paused round and resume it via RoundManager
    const pausedRound = await this.rounds.findPausedRound(competitionId);

    if (pausedRound) {
      // Load round context if not already loaded
      const stageId = this.stages.getContext()?.stageId;
      if (stageId) {
        await this.rounds.prepareRound(competitionId, stageId, pausedRound.id);

        // Resume round (updates DB, resumes timer, emits ROUND_RESUMED)
        const resumeResult = await this.rounds.resumeRound();
        emissions.push(...resumeResult.emissions);

        // Restart timer tick interval
        this.rounds.startTimerTick(competitionId, (compId, rId) => {
          this.endRound(compId, rId);
        });

        // Restart R2 rotation intervals
        if (pausedRound.type === 'ROUND2_RELAY') {
          const teams = await this._prisma.teams.findMany({
            where: { competition_id: competitionId },
          });
          for (const team of teams) {
            const nextRotationAt = Date.now() + 60000;
            await this.state.setRound2NextRotation(pausedRound.id, team.id, nextRotationAt);
          }
          this.round2.startRotationIntervals(competitionId, pausedRound.id, teams, (tid, rid, teamId) => {
            this._handleRotation(tid, rid, teamId);
          });
        }
      }
    }

    // Atomic competition status transition: PAUSED → RUNNING
    const updateResult = await this._prisma.competitions.updateMany({
      where: { id: competitionId, status: 'PAUSED' },
      data: { status: 'RUNNING' },
    });
    if (updateResult.count === 0) {
      throw new CompetitionError('比赛状态不允许恢复 (already resumed or state changed)');
    }

    emissions.push({
      target: 'competition', targetId: competitionId, event: 'COMPETITION_RESUMED',
      payload: { competitionId },
    });

    return { result: { competitionId, status: 'RUNNING' }, emissions };
  }

  // ─── End round ────────────────────────────────────────────────

  async endRound(competitionId, roundId) {
    // Phase 1: Atomic status transition — claim this round for ending (prevents double-end)
    const updateResult = await this._prisma.rounds.updateMany({
      where: { id: roundId, status: { not: 'FINISHED' } },
      data: { status: 'FINISHED', ended_at: new Date() },
    });
    if (updateResult.count === 0) throw new RoundError('轮次状态不允许结束 (already finished or concurrent end)');

    // Phase 2: Read round data for post-end processing (bonuses, scoring, etc.)
    const round = await this._prisma.rounds.findUnique({
      where: { id: roundId },
    });

    const emissions = [];

    // Get remaining before cleanup for R1 time bonus calculation
    const remaining = await this.timer.getRemainingSeconds(roundId);

    // Stop timer ticks and R2 rotations before finishing
    this.rounds.clearTimerTick();

    // Round-specific cleanup via engine
    const engine = this._getEngine(round.type);
    await engine.cleanup(competitionId, roundId);

    // Round 1 time bonus
    if (round.type === 'ROUND1_NINE_ONE') {
      const bonusEmissions = await this.round1.applyTimeBonuses(competitionId, roundId, remaining);
      emissions.push(...bonusEmissions);
    }

    // Round 2 rotation cleanup
    if (round.type === 'ROUND2_RELAY') {
      const teams = await this._prisma.teams.findMany({
        where: { competition_id: competitionId },
      });
      this.round2.clearRotationIntervals(roundId, teams);
    }

    // Round 3 completion bonus
    if (round.type === 'ROUND3_COLLABORATE') {
      const teams = await this._prisma.teams.findMany({
        where: { competition_id: competitionId },
      });

      // Batch-fetch puzzle data once (same for all teams)
      const roundPuzzleIds = (await this._prisma.round_puzzles.findMany({
        where: { round_id: roundId },
        select: { puzzle_id: true },
      })).map(rp => rp.puzzle_id);

      const totalPuzzles = roundPuzzleIds.length;

      const solvedAnswers = await this._prisma.puzzle_answers.findMany({
        where: {
          player_round_sessions: { round_id: roundId },
          puzzle_id: { in: roundPuzzleIds },
          progress_percentage: { gte: 100 },
        },
        distinct: ['puzzle_id'],
      });
      const solvedCount = solvedAnswers.length;

      for (const team of teams) {
        const completionBonus = await this.scoring.applyRound3CompletionBonus(
          competitionId, roundId, team.id, remaining, solvedCount, totalPuzzles
        );
        if (completionBonus > 0) {
          const teamScore = this.scoring.findTeamScore(competitionId, roundId, team.id);
          emissions.push({
            target: 'team', targetId: { competitionId, teamId: team.id }, event: 'SCORE_UPDATE',
            payload: {
              roundId, teamId: team.id, teamName: team.name,
              teamTotalPoints: teamScore?.total_points || 0,
              completionBonus, bonusMinutes: Math.floor(remaining / 60),
            },
          });
        }
      }
    }

    // Individual round auto-save flush and scoring
    if (isIndividualRoundType(round.type)) {
      // Get all players in this competition
      const players = await this._prisma.players.findMany({
        where: { competition_id: competitionId },
        include: { users: { select: { id: true, username: true } } },
      });

      // Get all puzzles for this round
      const roundPuzzles = await this._prisma.round_puzzles.findMany({
        where: { round_id: roundId },
        include: { puzzles: true },
      });

      // Batch-fetch all sessions for this round (replaces per-player findUnique)
      const allSessions = await this._prisma.player_round_sessions.findMany({
        where: { round_id: roundId },
      });
      const sessionMap = new Map(allSessions.map(s => [s.participant_id, s]));

      // Batch-fetch all puzzle_answers for those sessions (replaces per-puzzle findFirst)
      const sessionIds = allSessions.map(s => s.id);
      const allAnswers = sessionIds.length > 0
        ? await this._prisma.puzzle_answers.findMany({
            where: { session_id: { in: sessionIds } },
          })
        : [];
      const answerMap = new Map(allAnswers.map(a => [`${a.session_id}:${a.puzzle_id}`, a]));

      // Batch-fetch all round_rankings for this round (replaces per-player findFirst)
      const allRankings = await this._prisma.round_rankings.findMany({
        where: { round_id: roundId },
      });
      const rankingMap = new Map(allRankings.map(r => [r.participant_id, r]));

      // Collect all write operations for batch execution
      const writeOps = [];

      for (const player of players) {
        let totalRoundScore = 0;
        let solvedCount = 0;

        // Use batch-fetched session map
        const session = sessionMap.get(player.id);

        if (!session) {
          // No session found — player may not have started; skip scoring
          continue;
        }

        for (const rp of roundPuzzles) {
          const puzzle = rp.puzzles;

          // Flush in-memory grid to puzzle_answers
          const inMemoryGrid = await this.state.getIndividualPlayerGrid(roundId, player.id, puzzle.id);
          const answer = answerMap.get(`${session.id}:${puzzle.id}`);

          let playerGrid = inMemoryGrid || (answer?.current_grid
            ? (typeof answer.current_grid === 'string' ? JSON.parse(answer.current_grid) : answer.current_grid)
            : null);

          if (!playerGrid) continue;

          // Calculate completion score
          const solution = typeof puzzle.solution_grid === 'string'
            ? JSON.parse(puzzle.solution_grid)
            : puzzle.solution_grid;
          const initialGrid = typeof puzzle.initial_grid === 'string'
            ? JSON.parse(puzzle.initial_grid)
            : puzzle.initial_grid;

          const completion = this.scoring.calculateCompletion(initialGrid, solution, playerGrid);
          const maxPoints = puzzle.score || 100;
          const puzzleScore = Math.round(maxPoints * completion.completionRatio);

          // Queue puzzle_answers upsert for batch execution
          writeOps.push(this._prisma.puzzle_answers.upsert({
            where: {
              session_id_puzzle_id: {
                session_id: session.id,
                puzzle_id: puzzle.id,
              },
            },
            create: {
              session_id: session.id,
              puzzle_id: puzzle.id,
              current_grid: playerGrid,
              correct_cells: completion.correctlyFilledCells,
              total_empty_cells: completion.totalOriginallyEmptyCells,
              progress_percentage: completion.completionRatio * 100,
            },
            update: {
              current_grid: playerGrid,
              correct_cells: completion.correctlyFilledCells,
              total_empty_cells: completion.totalOriginallyEmptyCells,
              progress_percentage: completion.completionRatio * 100,
            },
          }));

          totalRoundScore += puzzleScore;
          if (completion.completionRatio >= 1.0) solvedCount++;
        }

        // Queue round_rankings upsert using batch-fetched map
        const existingRanking = rankingMap.get(player.id);
        if (existingRanking) {
          writeOps.push(this._prisma.round_rankings.update({
            where: { id: existingRanking.id },
            data: { score: totalRoundScore, category_id: player.category_id },
          }));
        } else {
          writeOps.push(this._prisma.round_rankings.create({
            data: {
              round_id: roundId,
              participant_id: player.id,
              score: totalRoundScore,
              rank: 0,
              category_id: player.category_id,
            },
          }));
        }

        // Emit score update
        emissions.push({
          target: 'user',
          targetId: player.user_id,
          event: 'INDIVIDUAL_ROUND_COMPLETE',
          payload: {
            roundId,
            playerId: player.user_id,
            playerName: player.users?.username || 'Unknown',
            totalScore: totalRoundScore,
            solvedCount,
            totalPuzzles: roundPuzzles.length,
          },
        });
      }

      // Execute all writes in a single transaction
      if (writeOps.length > 0) {
        await this._prisma.$transaction(writeOps);
      }

      // Compute ranks within each category (descending score order)
      const rankings = await this._prisma.round_rankings.findMany({
        where: { round_id: roundId },
        orderBy: { score: 'desc' },
      });

      // Group by category_id and assign ranks in batch transaction
      const categoryGroups = {};
      rankings.forEach(r => {
        const catId = r.category_id || 'null';
        if (!categoryGroups[catId]) categoryGroups[catId] = [];
        categoryGroups[catId].push(r);
      });

      const rankOps = [];
      for (const catId in categoryGroups) {
        const group = categoryGroups[catId];
        for (let i = 0; i < group.length; i++) {
          rankOps.push(this._prisma.round_rankings.update({
            where: { id: group[i].id },
            data: { rank: i + 1 },
          }));
        }
      }
      if (rankOps.length > 0) {
        await this._prisma.$transaction(rankOps);
      }

      // Clean up in-memory grids
      await this.state.deleteIndividualPlayerGrids(roundId);
    }

    // Finish round via RoundManager (updates DB, cleans up timer, emits ROUND_FINISHED)
    // Re-load context if it was for a different round (e.g., called from timer expire)
    const currentCtx = this.rounds.getContext();
    if (!currentCtx || currentCtx.roundId !== roundId) {
      const stageId = this.stages.getContext()?.stageId || round.stage_id;
      if (stageId) {
        await this.rounds.prepareRound(competitionId, stageId, roundId);
      }
    }

    // Ensure lifecycle is in ROUND_ACTIVE before finishRound()
    const lifecycle = this.rounds.getLifecycleState();
    if (lifecycle === 'PREPARATION') {
      // Round ended during preparation — skip to activate then finish
      await this.rounds.activateRound();
    }

    const finishResult = await this.rounds.finishRound();
    emissions.push(...finishResult.emissions);

    // Auto-chain: start next round (with transition delay) or finish stage
    const hasNext = await this.rounds.hasNextRound();
    if (hasNext) {
      const nextRound = await this.rounds.getNextRound();
      if (nextRound) {
        // Emit transition event so clients can show "next round in X seconds"
        emissions.push({
          target: 'competition',
          targetId: competitionId,
          event: 'ROUND_TRANSITION_STARTED',
          payload: {
            finishedRoundId: roundId,
            nextRoundId: nextRound.id,
            nextRoundName: nextRound.name,
            nextRoundType: nextRound.type,
            nextRoundOrder: nextRound.order_number,
            transitionSeconds: DEFAULT_TRANSITION_SECONDS,
          },
        });

        // Schedule next round start after transition delay (non-blocking)
        if (DEFAULT_TRANSITION_SECONDS > 0) {
          setTimeout(async () => {
            try {
              const nextStartResult = await this.startRound(competitionId, nextRound.id);
              this.bus.emitAll(nextStartResult.emissions);
            } catch (e) {
              console.error('[GameOrchestrator] Failed to auto-start next round:', e.message);
            }
          }, DEFAULT_TRANSITION_SECONDS * 1000);
        } else {
          // No transition delay — start immediately
          const nextStartResult = await this.startRound(competitionId, nextRound.id);
          emissions.push(...nextStartResult.emissions);
        }
      }
    } else {
      // Last round in stage — auto-finish the stage
      try {
        const stageFinishResult = await this.stages.finishStage();
        emissions.push(...stageFinishResult.emissions);

        // Emit STAGE_RANKING display mode after stage finishes
        if (this.displayManager) {
          setTimeout(async () => {
            try {
              await this.displayManager.emitStageRanking(competitionId);
            } catch (e) {
              console.error('[GameOrchestrator] Failed to emit stage ranking:', e.message);
            }
          }, 100);
        }
      } catch (e) {
        // Stage finish may fail if rounds aren't all finished (e.g., manual endRound)
        // This is non-fatal; judge can still trigger finishStage manually
      }
    }

    // Emit ROUND_RANKING display mode after round finishes (if not transitioning to stage finish)
    if (hasNext && this.displayManager) {
      setTimeout(async () => {
        try {
          await this.displayManager.emitRoundRanking(competitionId);
        } catch (e) {
          console.error('[GameOrchestrator] Failed to emit round ranking:', e.message);
        }
      }, 100);
    }

    return { result: { roundId, status: 'FINISHED' }, emissions };
  }

  // ─── Stage queries ─────────────────────────────────────────────

  /**
   * List all stages with rounds for a competition.
   * @param {string} competitionId
   * @returns {Promise<Array>} stages array
   */
  async listStages(competitionId) {
    return this.stages.loadAllStages(competitionId);
  }

  /**
   * Configure stage order and types for a competition.
   * Expects an array of stage objects: [{ id?, type, orderNumber }]
   *
   * - If id is provided: update that existing stage.
   * - If id is omitted: create a new stage.
   * - Stages not in the array but present in DB are deleted.
   *
   * Only allowed when competition is DRAFT.
   *
   * @param {string} competitionId
   * @param {Array<{id?: string, type: string, orderNumber: number}>} stageConfigs
   * @returns {Promise<Array>} updated stages
   */
  async configureStages(competitionId, stageConfigs) {
    const comp = await this._prisma.competitions.findUnique({
      where: { id: competitionId },
    });
    if (!comp) throw new CompetitionError('比赛不存在');
    if (comp.status === 'RUNNING' || comp.status === 'FINISHED') {
      throw new CompetitionError('比赛进行中或已结束，无法修改阶段配置');
    }

    // Validate input
    if (!Array.isArray(stageConfigs) || stageConfigs.length === 0) {
      throw new StageError('至少需要一个阶段');
    }

    for (const cfg of stageConfigs) {
      if (!cfg.type || !['INDIVIDUAL', 'TEAM', 'PK'].includes(cfg.type)) {
        throw new StageError(`无效的阶段类型: ${cfg.type}`);
      }
      if (typeof cfg.orderNumber !== 'number' || cfg.orderNumber < 1) {
        throw new StageError(`orderNumber 必须是正整数: ${cfg.orderNumber}`);
      }
    }

    // Check for duplicate orderNumbers
    const orderNumbers = stageConfigs.map(s => s.orderNumber);
    if (new Set(orderNumbers).size !== orderNumbers.length) {
      throw new StageError('阶段序号不能重复');
    }

    // Execute in a transaction
    const result = await this._prisma.$transaction(async (tx) => {
      // Get existing stages
      const existing = await tx.competition_stages.findMany({
        where: { competition_id: competitionId },
      });
      const existingIds = new Set(existing.map(s => s.id));
      const incomingIds = new Set(stageConfigs.filter(s => s.id).map(s => s.id));

      // Delete stages not in the incoming array
      for (const old of existing) {
        if (!incomingIds.has(old.id)) {
          // Delete rounds belonging to this stage first
          await tx.rounds.deleteMany({ where: { stage_id: old.id } });
          await tx.competition_stages.delete({ where: { id: old.id } });
        }
      }

      // Upsert each incoming stage config
      for (const cfg of stageConfigs) {
        if (cfg.id && existingIds.has(cfg.id)) {
          // Update existing stage
          await tx.competition_stages.update({
            where: { id: cfg.id },
            data: {
              type: cfg.type,
              order_number: cfg.orderNumber,
            },
          });
        } else {
          // Create new stage
          await tx.competition_stages.create({
            data: {
              competition_id: competitionId,
              type: cfg.type,
              order_number: cfg.orderNumber,
              status: 'WAITING',
            },
          });
        }
      }

      // Return all stages with rounds
      return tx.competition_stages.findMany({
        where: { competition_id: competitionId },
        include: {
          rounds: { orderBy: { order_number: 'asc' } },
        },
        orderBy: { order_number: 'asc' },
      });
    });

    return result;
  }

  // ─── Manual stage finish (judge-triggered) ──────────────────────

  /**
   * Manually finish a stage. Called by judge from frontend.
   * Validates all rounds are finished before allowing stage to end.
   *
   * @param {string} competitionId
   * @param {string} stageId
   * @returns {Promise<{result: Object, emissions: Array}>}
   */
  async finishStage(competitionId, stageId) {
    // Validate competition is RUNNING or PAUSED
    const comp = await this._prisma.competitions.findUnique({
      where: { id: competitionId },
    });
    if (!comp) throw new CompetitionError('比赛不存在');
    if (comp.status !== 'RUNNING' && comp.status !== 'PAUSED') {
      throw new CompetitionError('比赛状态不允许结束阶段');
    }

    // Load stage context if needed
    const currentCtx = this.stages.getContext();
    if (!currentCtx || currentCtx.stageId !== stageId) {
      await this.stages.loadStageContext(competitionId, stageId);
    }

    // Delegate to StageManager (validates all rounds finished)
    const { result, emissions } = await this.stages.finishStage();

    // Emit STAGE_RANKING display mode after stage finishes (judge-triggered path)
    if (this.displayManager) {
      setTimeout(async () => {
        try {
          await this.displayManager.emitStageRanking(competitionId);
        } catch (e) {
          console.error('[GameOrchestrator] Failed to emit stage ranking:', e.message);
        }
      }, 100);
    }

    return { result, emissions };
  }

  // ─── Stage-to-stage progression (judge-triggered) ─────────────────

  /**
   * Transition from the current finished stage to the next stage.
   * Finds the next stage by order_number, starts it, and auto-chains
   * into the first round's preparation countdown.
   *
   * @param {string} competitionId
   * @returns {Promise<{result: Object, emissions: Array}>}
   * @throws {StageError} if no next stage exists
   */
  async startNextStage(competitionId) {
    const comp = await this._prisma.competitions.findUnique({
      where: { id: competitionId },
    });
    if (!comp) throw new CompetitionError('比赛不存在');
    if (comp.status !== 'RUNNING') {
      throw new CompetitionError('比赛状态不允许切换阶段');
    }

    // Ensure current stage context is loaded
    const currentCtx = this.stages.getContext();
    if (!currentCtx) {
      throw new StageError('当前无阶段上下文，请先结束当前阶段');
    }

    // Find next stage via StageManager
    const transitionResult = await this.stages.transitionToNextStage();
    const emissions = [...transitionResult.emissions];

    // Start the next stage (which auto-chains into first round)
    const startResult = await this.startStage(competitionId, transitionResult.result.toStageId);
    emissions.push(...startResult.emissions);

    return {
      result: {
        competitionId,
        fromStageId: transitionResult.result.fromStageId,
        toStageId: transitionResult.result.toStageId,
        toStageType: transitionResult.result.toStageType,
        status: 'STAGE_TRANSITIONED',
      },
      emissions,
    };
  }

  // ─── End competition ───────────────────────────────────────────

  async endCompetition(competitionId) {
    // Phase 1: Validate preconditions (read-only)
    const comp = await this._prisma.competitions.findUnique({
      where: { id: competitionId },
    });
    if (!comp) throw new CompetitionError('比赛不存在');
    if (comp.status === 'FINISHED') throw new CompetitionError('比赛状态不允许结束');

    // Business rule: all rounds must be FINISHED before competition can end
    const unfinishedRounds = await this._prisma.rounds.findMany({
      where: {
        competition_stages: { competition_id: competitionId },
        status: { not: 'FINISHED' },
      },
    });
    if (unfinishedRounds.length > 0) {
      throw new CompetitionError('所有轮次必须完成后才能结束比赛');
    }

    // Phase 2: Atomic status transition (prevents TOCTOU race condition)
    const emissions = [];
    const updateResult = await this._prisma.competitions.updateMany({
      where: { id: competitionId, status: { not: 'FINISHED' } },
      data: { status: 'FINISHED' },
    });
    if (updateResult.count === 0) {
      throw new CompetitionError('比赛状态不允许结束 (concurrent end detected)');
    }
    emissions.push({
      target: 'competition', targetId: competitionId, event: 'COMPETITION_FINISHED',
      payload: { competitionId },
    });

    // Emit FINAL_RANKING display mode after competition ends
    if (this.displayManager) {
      setTimeout(async () => {
        try {
          await this.displayManager.emitFinalRanking(competitionId);
        } catch (e) {
          console.error('[GameOrchestrator] Failed to emit final ranking:', e.message);
        }
      }, 100);
    }

    return { result: { competitionId, status: 'FINISHED' }, emissions };
  }

  // ─── Submit answer ────────────────────────────────────────────

  async submitAnswer(userId, roundId, puzzleId, submissionType, data) {
    const round = await this._prisma.rounds.findUnique({
      where: { id: roundId },
      include: { competition_stages: { select: { competition_id: true } } },
    });
    if (!round) throw new RoundError('轮次不存在');

    const competitionId = round.competition_stages.competition_id;
    const engine = this._getEngine(round.type);
    const { result, emissions } = await engine.submitAnswer(
      userId, competitionId, roundId, puzzleId, submissionType, data
    );

    return { result, emissions };
  }

  // ─── Round 2 cell update ──────────────────────────────────────

  async round2CellUpdate(userId, roundId, puzzleId, row, col, value) {
    const { result, emissions } = await this.round2.cellUpdate(userId, roundId, puzzleId, row, col, value);
    return { result, emissions };
  }

  // ─── Round 3 cell fill ────────────────────────────────────────

  async handleCellFill(userId, competitionId, roundId, puzzleId, row, col, value) {
    // In R3, cell_fill becomes a proposal (suggestion-based workflow)
    const round = await this._prisma.rounds.findUnique({
      where: { id: roundId },
    });
    if (round?.type === 'ROUND3_COLLABORATE' && this.r3Collaboration) {
      const user = await this._prisma.users.findUnique({
        where: { id: userId },
        select: { username: true },
      });
      const playerName = user?.username || 'Unknown';

      const teamId = await this._findTeamForPlayerInRound(roundId, userId);
      const { suggestion, emissions } = await this.round3.handleCellPropose(
        puzzleId, row, col, value, userId, playerName, teamId, roundId
      );
      return { result: { success: !!suggestion, suggestion }, emissions };
    }
    // Fallback for non-R3 or without collaboration service
    const { result, emissions } = await this.round3.handleCellFill(
      userId, competitionId, roundId, puzzleId, row, col, value
    );
    return { result, emissions };
  }

  // ─── Round 3 collaboration delegation ─────────────────────────

  async round3ProposeCell(userId, competitionId, roundId, puzzleId, row, col, value) {
    const user = await this._prisma.users.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    const playerName = user?.username || 'Unknown';

    const teamId = await this._findTeamForPlayerInRound(roundId, userId);
    const { suggestion, emissions } = await this.round3.handleCellPropose(
      puzzleId, row, col, value, userId, playerName, teamId, roundId
    );
    return { result: { success: !!suggestion, suggestion }, emissions };
  }

  async round3AcceptProposal(userId, competitionId, roundId, puzzleId, row, col) {
    const user = await this._prisma.users.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    const acceptorPlayerName = user?.username || 'Unknown';

    const teamId = await this._findTeamForPlayerInRound(roundId, userId);
    const { success, accepted, emissions } = await this.round3.handleCellAccept(
      puzzleId, row, col, userId, acceptorPlayerName, teamId, roundId, competitionId
    );
    return { result: { success, accepted }, emissions };
  }

  async round3RejectProposal(userId, competitionId, roundId, puzzleId, row, col) {
    const user = await this._prisma.users.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    const rejectorPlayerName = user?.username || 'Unknown';

    const teamId = await this._findTeamForPlayerInRound(roundId, userId);
    const { success, emissions } = await this.round3.handleCellReject(
      puzzleId, row, col, userId, rejectorPlayerName, teamId, roundId, competitionId
    );
    return { result: { success }, emissions };
  }

  async round3WithdrawProposal(userId, competitionId, roundId, puzzleId, row, col) {
    const teamId = await this._findTeamForPlayerInRound(roundId, userId);
    const { success, emissions } = await this.round3.handleCellWithdraw(
      puzzleId, row, col, userId, teamId, roundId, competitionId
    );
    return { result: { success }, emissions };
  }

  async round3FocusUpdate(userId, competitionId, roundId, puzzleId, row, col) {
    const user = await this._prisma.users.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    const playerName = user?.username || 'Unknown';

    const teamId = await this._findTeamForPlayerInRound(roundId, userId);
    const { emissions } = await this.round3.handleFocusUpdate(
      puzzleId, userId, playerName, row, col, teamId, roundId, competitionId
    );
    return { result: { success: true }, emissions };
  }

  /**
   * Clear a player's R3 focus when they disconnect.
   * Finds the active R3 puzzle and removes the focus entry + emits update.
   */
  async clearRound3PlayerFocus(userId, competitionId) {
    try {
      const activeRound = await this._prisma.rounds.findFirst({
        where: {
          competition_stages: { competition_id: competitionId },
          status: 'IN_PROGRESS',
        },
      });
      if (!activeRound || activeRound.type !== 'ROUND3_COLLABORATE') return;

      // Find the player's team via team_members → players
      const player = await this._prisma.players.findFirst({
        where: { competition_id: competitionId, user_id: userId },
      });
      if (!player) return;

      const membership = await this._prisma.team_members.findFirst({
        where: { participant_id: player.id },
      });
      if (!membership) return;

      // Find the current puzzle for this team in this round
      const teamRoundPuzzles = await this._prisma.round_puzzles.findMany({
        where: { round_id: activeRound.id },
        orderBy: { order_number: 'asc' },
        take: 1,
      });
      if (!teamRoundPuzzles || teamRoundPuzzles.length === 0) return;

      const currentPuzzleId = teamRoundPuzzles[0].puzzle_id;

      // Remove focus from state
      const focuses = await this.state.getRound3PlayerFocuses(currentPuzzleId);
      if (focuses && focuses[String(userId)]) {
        await this.state.setRound3PlayerFocus(currentPuzzleId, userId, null);

        // Emit focus removal to team
        const user = await this._prisma.users.findUnique({
          where: { id: userId },
          select: { username: true },
        });
        const playerName = user?.username || 'Unknown';

        this.bus.emitAll([{
          target: 'team',
          targetId: { competitionId, teamId: membership.team_id },
          event: 'ROUND3_FOCUS_UPDATE',
          payload: {
            roundId: activeRound.id, puzzleId: currentPuzzleId,
            playerId: userId, playerName, row: null, col: null,
          },
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

  // ─── Private query helpers ────────────────────────────────────

  /**
   * Find the team ID for a player in a given round.
   * Resolves: users → players (via user_id + competition) → team_members → teams
   * @private
   */
  async _findTeamForPlayerInRound(roundId, userId) {
    // Get the competition_id from the round
    const round = await this._prisma.rounds.findUnique({
      where: { id: roundId },
      include: { competition_stages: { select: { competition_id: true } } },
    });
    if (!round) return null;

    const competitionId = round.competition_stages.competition_id;

    // Find the player record for this user in this competition
    const player = await this._prisma.players.findFirst({
      where: { competition_id: competitionId, user_id: userId },
    });
    if (!player) return null;

    // Find team membership
    const membership = await this._prisma.team_members.findFirst({
      where: { participant_id: player.id },
    });
    return membership?.team_id || null;
  }
}

module.exports = GameOrchestrator;
