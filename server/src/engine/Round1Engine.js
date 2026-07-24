/**
 * Round1Engine — "Nine-in-One" round logic.
 *
 * 9 JOC puzzles (single-cell submission → reveals a letter clue).
 * 1 FINAL puzzle (full-grid submission, unlocked after all 9 JOC solved).
 * Time bonus: +3 pts/min remaining if all 10 completed.
 */

const RoundEngine = require('./RoundEngine');

class Round1Engine extends RoundEngine {
  /**
   * @param {import('../db/index')} repos
   * @param {import('../state/StateRepository')} state
   * @param {import('./ScoringService')} scoring
   * @param {import('../services/PuzzleAssignmentService')} puzzleAssignment
   */
  constructor(repos, state, scoring, puzzleAssignment) {
    super(repos, state, scoring);
    this.puzzleAssignment = puzzleAssignment;
    /** @type {Map<string, NodeJS.Timeout>} `${roundId}-${teamId}` → rotation interval (unused in R1, kept for API compat) */
    this._rotIntervals = new Map();
  }

  _r2k(roundId, teamId) { return `${roundId}-${teamId}`; }

  // ─── Setup ────────────────────────────────────────────────────

  async setup(tournamentId, roundId, teams, puzzles) {
    const emissions = [];
    const players = await this.repos.teams.getTournamentPlayers(tournamentId);

    // Use PuzzleAssignmentService for per-team non-overlapping puzzle sets
    const teamPuzzleMap = this.puzzleAssignment
      ? this.puzzleAssignment.assignPerTeamPuzzles(tournamentId, roundId, teams, puzzles)
      : null;

    for (const player of players) {
      await this.repos.playerStates.createRoundState({ roundId, playerId: player.id, teamId: player.team_id, status: 'ACTIVE' });

      // Determine this player's team puzzles (per-team or fallback to all)
      const teamPuzzles = teamPuzzleMap
        ? (teamPuzzleMap.get(player.team_id) || puzzles)
        : puzzles;

      // Renumber puzzles 1-10 per team for consistent UI
      for (let idx = 0; idx < teamPuzzles.length; idx++) {
        const isFinal = idx === 9 || teamPuzzles[idx].puzzle_type === 'FINAL';
        await this.repos.playerStates.createAssignment({
          roundId, playerId: player.id, puzzleId: teamPuzzles[idx].id,
          teamId: player.team_id, currentGrid: teamPuzzles[idx].initial_grid, isCompleted: false
        });
      }

      const playerPuzzles = teamPuzzles.map((p, idx) => {
        const isFinal = idx === 9 || p.puzzle_type === 'FINAL';
        return {
          puzzleId: p.id, puzzleType: p.puzzle_type, orderInRound: idx + 1,
          initialGrid: typeof p.initial_grid === 'string' ? JSON.parse(p.initial_grid) : p.initial_grid,
          points: p.points || 10,
          letter: p.letter, isFinal, isLocked: isFinal
        };
      });
      emissions.push(this._emitUser(player.id, 'PUZZLE_ASSIGN', { roundId, puzzles: playerPuzzles }));
    }

    return { result: { roundId, setup: 'ROUND1_NINE_ONE' }, emissions };
  }

  // ─── Submit answer ────────────────────────────────────────────

  async submitAnswer(userId, tournamentId, roundId, puzzleId, submissionType, data) {
    const emissions = [];
    const round = await this.repos.rounds.findById(roundId);
    if (!round || round.status !== 'IN_PROGRESS') throw new Error('轮次未在进行中');

    const assignment = await this.repos.playerStates.findActiveAssignment(roundId, userId, puzzleId);
    if (!assignment) throw new Error('该题目未分配给你或已提交');

    const puzzle = await this.repos.puzzles.findById(puzzleId);
    if (!puzzle) throw new Error('题目不存在');

    const solution = JSON.parse(puzzle.solution);
    let isCorrect = false;
    let pointsEarned = 0;

    if (submissionType === 'SINGLE_CELL' && puzzle.puzzle_type === 'JOC') {
      // ── JOC single-cell submission ──
      const { row, col, value } = data;
      isCorrect = solution[row] && solution[row][col] === value;
      if (isCorrect) pointsEarned = puzzle.points;

      // Duplicate check: already solved by team?
      if (isCorrect && assignment.team_id) {
        const teamSolved = await this.repos.submissions.findTeamSolvedPuzzle(roundId, puzzleId, assignment.team_id);
        if (teamSolved) {
          emissions.push(this._emitUser(userId, 'ANSWER_RESULT', { roundId, puzzleId, isCorrect: true, pointsEarned: 0, letter: puzzle.letter, alreadySolved: true }));
          return { result: { puzzleId, isCorrect: true, pointsEarned: 0, alreadySolved: true }, emissions };
        }
      }

      await this.repos.submissions.create({
        roundId, playerId: userId, puzzleId, teamId: assignment.team_id,
        submissionType: 'SINGLE_CELL', submittedValue: JSON.stringify({ row, col, value }),
        isCorrect, pointsEarned
      });

      if (isCorrect) {
        await this.repos.playerStates.markTeamAssignmentsCompleted(roundId, puzzleId, assignment.team_id);

        if (assignment.team_id) {
          this.scoring.addTeamPoints(round.tournament_id, roundId, assignment.team_id, pointsEarned);
        }
        this.scoring.addPlayerPoints(round.tournament_id, roundId, userId, assignment.team_id, pointsEarned);

        const teamScore = assignment.team_id ? this.scoring.findTeamScore(round.tournament_id, roundId, assignment.team_id) : null;
        const playerName = await this.repos.users.getDisplayName(userId);
        const letter = puzzle.letter;

        if (assignment.team_id) {
          emissions.push(this._emitTeam(round.tournament_id, assignment.team_id, 'ROUND1_PUZZLE_SOLVED', {
            roundId, puzzleId, solvedBy: userId, solvedByName: playerName,
            letter, puzzlePoints: pointsEarned, totalRound1Score: teamScore?.total_points || 0
          }));

          // Check if all 9 JOC solved → unlock final
          const teamCorrectSubmissions = await this.repos.submissions.findTeamJocCorrect(roundId, assignment.team_id);
          const solvedCount = teamCorrectSubmissions.length;
          const teamJocCount = await this.repos.puzzles.countTeamJoc(roundId, assignment.team_id);

          if (solvedCount >= teamJocCount && teamJocCount > 0) {
            const fp = await this.repos.puzzles.findTeamFinalPuzzle(roundId, assignment.team_id);
            if (fp) {
              const clues = teamCorrectSubmissions.sort((a, b) => a.order_in_round - b.order_in_round).map(s => s.letter);
              emissions.push(this._emitTeam(round.tournament_id, assignment.team_id, 'ROUND1_FINAL_UNLOCKED', {
                roundId, clues,
                finalPuzzleId: fp.id,
                finalPuzzle: {
                  puzzleId: fp.id, puzzleType: fp.puzzle_type, orderInRound: fp.order_in_round,
                  initialGrid: JSON.parse(fp.initial_grid), points: fp.points, isFinal: true, isLocked: false
                }
              }));
            }
          }

          // SCORE_UPDATE for judge panel
          const team = await this.repos.teams.findById(assignment.team_id);
          const playerScore = this.scoring.findPlayerScore(round.tournament_id, roundId, userId);
          emissions.push(this._emitTeam(round.tournament_id, assignment.team_id, 'SCORE_UPDATE', {
            roundId, teamId: assignment.team_id, teamName: team?.name || '',
            teamTotalPoints: teamScore?.total_points || 0,
            playerId: userId, playerTotalPoints: playerScore?.total_points || 0
          }));
        }

        emissions.push(this._emitUser(userId, 'ANSWER_RESULT', { roundId, puzzleId, isCorrect: true, pointsEarned, letter: puzzle.letter }));
      } else {
        emissions.push(this._emitUser(userId, 'ANSWER_RESULT', { roundId, puzzleId, isCorrect: false, pointsEarned: 0, letter: null }));
      }
    } else {
      // ── FULL_GRID submission (FINAL puzzle) ──
      const grid = data.grid;
      if (!grid) throw new Error('缺少棋盘数据');
      isCorrect = this._validateFullGrid(grid, solution);
      if (isCorrect) pointsEarned = puzzle.points;

      if (isCorrect) {
        // Duplicate check
        if (assignment.team_id) {
          const teamSolved = await this.repos.submissions.findTeamSolvedPuzzle(roundId, puzzleId, assignment.team_id);
          if (teamSolved) {
            emissions.push(this._emitUser(userId, 'ANSWER_RESULT', { roundId, puzzleId, isCorrect: true, pointsEarned: 0, alreadySolved: true }));
            return { result: { puzzleId, isCorrect: true, pointsEarned: 0, alreadySolved: true }, emissions };
          }
        }

        await this.repos.submissions.create({
          roundId, playerId: userId, puzzleId, teamId: assignment.team_id,
          submissionType: 'FULL_GRID', submittedValue: JSON.stringify(grid),
          isCorrect, pointsEarned
        });

        await this.repos.playerStates.markTeamAssignmentsCompleted(roundId, puzzleId, assignment.team_id);

        if (assignment.team_id) {
          this.scoring.addTeamPoints(round.tournament_id, roundId, assignment.team_id, pointsEarned);
        }
        this.scoring.addPlayerPoints(round.tournament_id, roundId, userId, assignment.team_id, pointsEarned);

        if (assignment.team_id) {
          const teamScore = this.scoring.findTeamScore(round.tournament_id, roundId, assignment.team_id);
          const playerName = await this.repos.users.getDisplayName(userId);
          const team = await this.repos.teams.findById(assignment.team_id);
          emissions.push(this._emitTeam(round.tournament_id, assignment.team_id, 'ROUND1_PUZZLE_SOLVED', {
            roundId, puzzleId, solvedBy: userId, solvedByName: playerName,
            letter: null, puzzlePoints: pointsEarned, totalRound1Score: teamScore?.total_points || 0, isFinal: true
          }));
          const playerScore = this.scoring.findPlayerScore(round.tournament_id, roundId, userId);
          emissions.push(this._emitTeam(round.tournament_id, assignment.team_id, 'SCORE_UPDATE', {
            roundId, teamId: assignment.team_id, teamName: team?.name || '',
            teamTotalPoints: teamScore?.total_points || 0,
            playerId: userId, playerTotalPoints: playerScore?.total_points || 0
          }));
        }

        emissions.push(this._emitUser(userId, 'ANSWER_RESULT', { roundId, puzzleId, isCorrect: true, pointsEarned }));
      } else {
        emissions.push(this._emitUser(userId, 'ANSWER_RESULT', { roundId, puzzleId, isCorrect: false, pointsEarned: 0 }));
      }
    }

    return { result: { puzzleId, isCorrect, pointsEarned }, emissions };
  }

  // ─── Reconnect state ──────────────────────────────────────────

  async getReconnectState(userId, tournamentId, roundId) {
    const member = await this.repos.teams.findMemberTeam(tournamentId, userId);
    if (!member) return null;

    const teamSolved = await this.repos.submissions.findTeamJocCorrect(roundId, member.team_id);
    const allTeamCorrect = await this.repos.submissions.findTeamCorrect(roundId, member.team_id);
    const teamJocCount = await this.repos.puzzles.countTeamJoc(roundId, member.team_id);
    const allSolved = teamSolved.length >= teamJocCount && teamJocCount > 0;

    const finalActuallySolved = allTeamCorrect.some(s => s.puzzle_type === 'FINAL');

    const clues = teamSolved.sort((a, b) => a.order_in_round - b.order_in_round)
      .map(s => ({ puzzleId: s.puzzle_id, letter: s.letter, orderInRound: s.order_in_round }));

    const teamScore = this.scoring.findTeamScore(tournamentId, roundId, member.team_id);
    const fp = await this.repos.puzzles.findTeamFinalPuzzle(roundId, member.team_id);

    return {
      solvedPuzzleIds: allTeamCorrect.map(s => s.puzzle_id),
      clues,
      jocSolvedCount: teamSolved.length,
      jocTotalCount: teamJocCount,
      finalUnlocked: allSolved,
      finalSolved: finalActuallySolved,
      finalPuzzleId: fp?.id || null,
      teamScore: teamScore?.total_points || 0
    };
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  async cleanup(tournamentId, roundId) {
    // Clear any rotation intervals (unlikely in R1, but safe)
    for (const [key, interval] of this._rotIntervals.entries()) {
      if (key.startsWith(`${roundId}-`)) {
        clearInterval(interval);
        this._rotIntervals.delete(key);
      }
    }
    // No StateRepository entries to clean for R1
  }

  // ─── Time bonus (called by orchestrator on round end) ─────────

  /**
   * Apply Round 1 time bonus for all teams.
   * @param {number} tournamentId
   * @param {number} roundId
   * @param {number} remainingSeconds
   * @returns {Emission[]} emissions for score updates
   */
  async applyTimeBonuses(tournamentId, roundId, remainingSeconds) {
    const emissions = [];
    const teams = await this.repos.teams.findByTournament(tournamentId);
    for (const team of teams) {
      const solvedPuzzleIds = await this.repos.submissions.findSolvedPuzzleIds(roundId, team.id);
      const teamPuzzleCount = await this.repos.puzzles.countTeamPuzzles(roundId, team.id);

      if (solvedPuzzleIds.length >= teamPuzzleCount && teamPuzzleCount > 0 && remainingSeconds > 0) {
        const bonusMinutes = Math.floor(remainingSeconds / 60);
        const timeBonus = bonusMinutes * 3;
        if (timeBonus > 0) {
          this.scoring.addTeamPoints(tournamentId, roundId, team.id, timeBonus);
          const teamScore = this.scoring.findTeamScore(tournamentId, roundId, team.id);
          emissions.push(this._emitTeam(tournamentId, team.id, 'SCORE_UPDATE', {
            roundId, teamId: team.id, teamName: team.name,
            teamTotalPoints: teamScore?.total_points || 0,
            timeBonus, bonusMinutes
          }));
        }
      }
    }
    return emissions;
  }
}

module.exports = Round1Engine;
