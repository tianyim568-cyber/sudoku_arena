/**
 * Round3Engine — Collaborative round logic with suggestion-based workflow (Team Round).
 *
 * All team members work on shared puzzles simultaneously.
 * Players PROPOSE cell fills; teammates ACCEPT or REJECT proposals.
 * When accepted, the cell becomes officially filled (atomic claim).
 * 10 puzzles per team: 5 Easy (10pts) + 3 Medium (20pts) + 2 Hard (45pts) = 200pts max.
 * Completion bonus: +5 pts/min remaining if all 10 solved.
 */

const RoundEngine = require('../RoundEngine');

class Round3Engine extends RoundEngine {
  /**
   * @param {import('../../db/index')} repos
   * @param {import('../../state/StateRepository')} state
   * @param {import('../ScoringService')} scoring
   * @param {import('../../services/Round3CollaborationService')} [r3Collaboration]
   */
  constructor(repos, state, scoring, r3Collaboration) {
    super(repos, state, scoring);
    this.r3Collaboration = r3Collaboration || null;
  }

  // ─── Setup ────────────────────────────────────────────────────

  async setup(tournamentId, roundId, teams, puzzles) {
    const emissions = [];

    for (const team of teams) {
      const members = await this.repos.teams.getMembersWithDetails(team.id);
      if (members.length === 0) continue;

      // Assign difficulty-based points
      const teamPuzzles = puzzles.filter(p => p.team_id === team.id || !p.team_id);
      for (const puzzle of teamPuzzles) {
        const diff = puzzle.difficulty || 'EASY';
        const pts = this.scoring.getRound3DifficultyPoints(diff);
        if (pts !== puzzle.points) {
          try { await this.repos.puzzles.updatePoints(puzzle.id, pts); } catch (e) { /* non-critical */ }
        }
        puzzle.points = pts;
      }

      // First puzzle is the active one
      const firstPuzzle = teamPuzzles[0];
      if (!firstPuzzle) continue;

      // Initialize R3 state: cells, suggestions, player focuses
      await this.state.setRound3Cells(firstPuzzle.id, {});
      if (this.r3Collaboration) {
        // Suggestions/focuses are lazily created on demand, no need to init empty
      }

      for (const member of members) {
        await this.repos.playerStates.createRoundState({ roundId, playerId: member.player_id, teamId: team.id, status: 'ACTIVE' });
        await this.repos.playerStates.createAssignment({
          roundId, playerId: member.player_id, puzzleId: firstPuzzle.id,
          teamId: team.id, currentGrid: firstPuzzle.initial_grid, isCompleted: false
        });

        // Build the full puzzle list for the team
        const puzzleList = teamPuzzles.map(p => ({
          puzzleId: p.id, puzzleType: p.puzzle_type, orderInRound: p.order_in_round,
          initialGrid: JSON.parse(p.initial_grid), points: p.points,
          difficulty: p.difficulty || 'EASY', letter: p.letter || null
        }));

        emissions.push(this._emitUser(member.player_id, 'PUZZLE_ASSIGN', {
          roundId, puzzles: puzzleList
        }));
      }
    }

    return { result: { roundId, setup: 'ROUND3_COLLABORATE' }, emissions };
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
    const grid = data.grid;
    if (!grid) throw new Error('缺少棋盘数据');

    const isCorrect = this._validateFullGrid(grid, solution);
    const difficulty = puzzle.difficulty || 'EASY';
    const pointsEarned = isCorrect ? this.scoring.getRound3DifficultyPoints(difficulty) : 0;

    if (isCorrect) {
      await this.repos.playerStates.markCompleted(assignment.id);
      this.scoring.addPlayerPoints(round.tournament_id, roundId, userId, assignment.team_id, pointsEarned);

      if (assignment.team_id) {
        this.scoring.addTeamPoints(round.tournament_id, roundId, assignment.team_id, pointsEarned);
        const team = await this.repos.teams.findById(assignment.team_id);
        const teamScore = this.scoring.findTeamScore(round.tournament_id, roundId, assignment.team_id);
        const playerScore = this.scoring.findPlayerScore(round.tournament_id, roundId, userId);
        emissions.push(this._emitTeam(round.tournament_id, assignment.team_id, 'SCORE_UPDATE', {
          roundId, teamId: assignment.team_id, teamName: team?.name || '',
          teamTotalPoints: teamScore?.total_points || 0,
          playerId: userId, playerTotalPoints: playerScore?.total_points || 0
        }));
      }

      emissions.push(this._emitUser(userId, 'ANSWER_RESULT', { roundId, puzzleId, isCorrect: true, pointsEarned, difficulty }));

      // Assign next puzzle for the team
      if (assignment.team_id) {
        const nextEmissions = await this._assignNextTeamPuzzle(tournamentId, roundId, assignment.team_id);
        emissions.push(...nextEmissions);
      }
    } else {
      emissions.push(this._emitUser(userId, 'ANSWER_RESULT', { roundId, puzzleId, isCorrect: false, pointsEarned: 0 }));
    }

    return { result: { puzzleId, isCorrect, pointsEarned }, emissions };
  }

  // ─── Cell fill (atomic claim) — kept for backward compat, but R3 prefers propose/accept ──

  async handleCellFill(userId, tournamentId, roundId, puzzleId, row, col, value) {
    const emissions = [];
    const playerName = await this.repos.users.getDisplayName(userId);

    // Atomic claim via StateRepository
    const result = await this.state.claimRound3Cell(puzzleId, row, col, value, userId, playerName);

    if (!result.success) {
      const existing = result.existing;
      if (existing && existing.playerId !== userId) {
        emissions.push(this._emitUser(userId, 'CELL_CONFLICT', {
          roundId, puzzleId, row, col, attemptedValue: value,
          actualValue: existing.value, filledBy: existing.playerName
        }));
        return { result: { success: false, message: '格子已被其他队员占用' }, emissions };
      }
      // Same player — idempotent accept
      return { result: { success: true }, emissions };
    }

    // Check if cell has an initial value (should not be modified)
    const puzzle = await this.repos.puzzles.findById(puzzleId);
    const initial = JSON.parse(puzzle.initial_grid);
    if (initial[row]?.[col] !== 0) {
      // Reject and clean up — only delete this cell, not all cells
      const key = `${row}-${col}`;
      const cells = await this.state.getRound3Cells(puzzleId);
      delete cells[key];
      await this.state.setRound3Cells(puzzleId, cells);
      return { result: { success: false, message: '初始格子不可修改' }, emissions };
    }

    // Broadcast to team
    const assignment = await this.repos.playerStates.findAnyAssignment(roundId, userId, puzzleId);
    if (assignment?.team_id) {
      emissions.push(this._emitTeam(tournamentId, assignment.team_id, 'CELL_BROADCAST', {
        roundId, puzzleId, playerId: userId, playerName,
        row, col, value
      }));
    }

    return { result: { success: true }, emissions };
  }

  // ─── Suggestion-based collaboration (delegates to Round3CollaborationService) ──

  async handleCellPropose(puzzleId, row, col, value, playerId, playerName, teamId, roundId) {
    if (!this.r3Collaboration) {
      // Fallback: direct claim without proposal
      return this.handleCellFill(playerId, null, roundId, puzzleId, row, col, value);
    }
    return this.r3Collaboration.proposeCell(puzzleId, row, col, value, playerId, playerName, teamId, roundId);
  }

  async handleCellAccept(puzzleId, row, col, acceptorPlayerId, acceptorPlayerName, teamId, roundId, tournamentId) {
    if (!this.r3Collaboration) {
      return { success: false, accepted: false, emissions: [] };
    }
    return this.r3Collaboration.acceptProposal(puzzleId, row, col, acceptorPlayerId, acceptorPlayerName, teamId, roundId, tournamentId);
  }

  async handleCellReject(puzzleId, row, col, rejectorPlayerId, rejectorPlayerName, teamId, roundId, tournamentId) {
    if (!this.r3Collaboration) {
      return { success: false, emissions: [] };
    }
    return this.r3Collaboration.rejectProposal(puzzleId, row, col, rejectorPlayerId, rejectorPlayerName, teamId, roundId, tournamentId);
  }

  async handleCellWithdraw(puzzleId, row, col, playerId, teamId, roundId, tournamentId) {
    if (!this.r3Collaboration) {
      return { success: false, emissions: [] };
    }
    return this.r3Collaboration.withdrawProposal(puzzleId, row, col, playerId, teamId, roundId, tournamentId);
  }

  async handleFocusUpdate(puzzleId, playerId, playerName, row, col, teamId, roundId, tournamentId) {
    if (!this.r3Collaboration) {
      return { emissions: [] };
    }
    return this.r3Collaboration.updatePlayerFocus(puzzleId, playerId, playerName, row, col, teamId, roundId, tournamentId);
  }

  // ─── Assign next puzzle ───────────────────────────────────────

  async _assignNextTeamPuzzle(tournamentId, roundId, teamId) {
    const emissions = [];
    const assignedPuzzleIds = await this.repos.playerStates.findAssignedPuzzleIds(roundId, teamId);
    const allPuzzles = await this.repos.puzzles.findByRound(roundId);
    const nextPuzzle = allPuzzles.find(p => !assignedPuzzleIds.includes(p.id));

    if (nextPuzzle) {
      // Initialize R3 state for the new puzzle
      await this.state.setRound3Cells(nextPuzzle.id, {});
      // Suggestions/focuses are lazily created

      const members = await this.repos.teams.getMembersWithDetails(teamId);
      const difficulty = nextPuzzle.difficulty || 'EASY';
      const points = this.scoring.getRound3DifficultyPoints(difficulty);

      for (const member of members) {
        await this.repos.playerStates.createAssignment({
          roundId, playerId: member.player_id, puzzleId: nextPuzzle.id,
          teamId, currentGrid: nextPuzzle.initial_grid, isCompleted: false
        });
        emissions.push(this._emitUser(member.player_id, 'PUZZLE_ASSIGN', {
          roundId, puzzles: [{
            puzzleId: nextPuzzle.id, puzzleType: nextPuzzle.puzzle_type,
            orderInRound: nextPuzzle.order_in_round,
            initialGrid: JSON.parse(nextPuzzle.initial_grid), points,
            difficulty, letter: nextPuzzle.letter || null
          }]
        }));
      }
      emissions.push(this._emitTeam(tournamentId, teamId, 'TEAM_PUZZLE_NEXT', {
        roundId, puzzleId: nextPuzzle.id, difficulty, points
      }));
    }

    return emissions;
  }

  // ─── Reconnect state ──────────────────────────────────────────

  async getReconnectState(userId, tournamentId, roundId) {
    const member = await this.repos.teams.findMemberTeam(tournamentId, userId);
    if (!member) return null;

    // Get all team puzzles with difficulty/points info
    const teamPuzzles = await this.repos.puzzles.findByRoundAndTeam(roundId, member.team_id);
    const solvedPuzzleIds = await this.repos.submissions.findSolvedPuzzleIds(roundId, member.team_id);
    const solvedIds = new Set(solvedPuzzleIds);
    const teamScore = this.scoring.findTeamScore(tournamentId, roundId, member.team_id);

    // Get current active assignment
    const assignment = await this.repos.playerStates.findActiveAssignment(roundId, userId, null);
    const currentPuzzleId = assignment?.puzzle_id || (teamPuzzles.length > 0 ? teamPuzzles[0].id : null);

    // Build puzzle list with full metadata
    const puzzleList = teamPuzzles.map(p => ({
      puzzleId: p.id, puzzleType: p.puzzle_type, orderInRound: p.order_in_round,
      initialGrid: JSON.parse(p.initial_grid), points: p.points,
      difficulty: p.difficulty || 'EASY', letter: p.letter || null,
      isCompleted: solvedIds.has(p.id)
    }));

    // Get collaboration state for current puzzle
    let cells = {};
    let suggestions = {};
    let playerFocuses = {};
    let suggestionVotes = {};

    if (currentPuzzleId) {
      cells = await this.state.getRound3Cells(currentPuzzleId);
      if (this.r3Collaboration) {
        const collabState = await this.r3Collaboration.getPuzzleState(currentPuzzleId);
        suggestions = collabState.suggestions;
        playerFocuses = collabState.playerFocuses;
        suggestionVotes = collabState.suggestionVotes;
      }
    }

    return {
      puzzles: puzzleList,
      currentPuzzleId,
      cells,
      suggestions,
      playerFocuses,
      suggestionVotes,
      teamScore: teamScore?.total_points || 0,
      solvedCount: solvedIds.size,
      totalPuzzles: teamPuzzles.length
    };
  }

  async getCells(puzzleId) {
    return this.state.getRound3Cells(puzzleId);
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  async cleanup(tournamentId, roundId) {
    const puzzles = await this.repos.puzzles.findByRound(roundId);
    for (const puzzle of puzzles) {
      await this.state.deleteRound3Cells(puzzle.id);
      if (this.r3Collaboration) {
        await this.r3Collaboration.clearPuzzleState(puzzle.id);
      }
    }
  }
}

module.exports = Round3Engine;
