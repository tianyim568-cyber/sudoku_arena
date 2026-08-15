/**
 * Round2Engine — Relay round logic (Team Round).
 *
 * Each team has 16 puzzles. Players are assigned one puzzle at a time.
 * Every 60s, puzzle assignments rotate among team members.
 * Points: Easy=8, Medium=16, Hard=20. Max 200 per team.
 * Completion bonus: +3 pts/min remaining when all 16 solved.
 */

const RoundEngine = require('../RoundEngine');

class Round2Engine extends RoundEngine {
  /**
   * @param {import('../../db/index')} repos
   * @param {import('../../state/StateRepository')} state
   * @param {import('../ScoringService')} scoring
   * @param {import('../../services/Round2NotificationService')} [r2Notification]
   */
  constructor(repos, state, scoring, r2Notification) {
    super(repos, state, scoring);
    this.r2Notification = r2Notification || null;
    /** @type {Map<string, NodeJS.Timeout>} `${roundId}-${teamId}` → rotation interval */
    this._rotIntervals = new Map();
  }

  _r2k(roundId, teamId) { return `${roundId}-${teamId}`; }

  // ─── Setup ────────────────────────────────────────────────────

  async setup(competitionId, roundId, teams, puzzles) {
    const emissions = [];

    for (const team of teams) {
      const members = await this.repos.teams.getMembersWithDetails(team.id);
      if (members.length === 0) continue;

      const teamPuzzles = puzzles.filter(p => p.team_id === team.id || !p.team_id);
      if (teamPuzzles.length === 0) continue;

      const shuffledPuzzles = [...teamPuzzles].sort(() => Math.random() - 0.5);

      for (const member of members) {
        await this.repos.playerStates.createRoundState({ roundId, playerId: member.player_id, teamId: team.id, status: 'ACTIVE' });
      }

      const playerPuzzleMap = {};
      const puzzleGridMap = {};
      const playerOrder = members.map(m => m.player_id);
      let puzzleIdx = 0;

      for (const member of members) {
        if (puzzleIdx < shuffledPuzzles.length) {
          const puzzle = shuffledPuzzles[puzzleIdx];
          playerPuzzleMap[member.player_id] = puzzle.id;
          puzzleGridMap[puzzle.id] = JSON.parse(puzzle.initial_grid);
          await this.repos.playerStates.createAssignment({
            roundId, playerId: member.player_id, puzzleId: puzzle.id,
            teamId: team.id, currentGrid: puzzle.initial_grid, isCompleted: false
          });
          puzzleIdx++;
        }
      }

      // Track remaining unassigned puzzles
      for (let i = puzzleIdx; i < shuffledPuzzles.length; i++) {
        const puzzle = shuffledPuzzles[i];
        puzzleGridMap[puzzle.id] = JSON.parse(puzzle.initial_grid);
      }

      const nextRotationAt = Date.now() + 60000;

      await this.state.setRound2TeamState(roundId, team.id, {
        playerPuzzles: playerPuzzleMap,
        puzzleGrids: puzzleGridMap,
        playerOrder,
        nextRotationAt,
        rotationIntervalMs: 60000
      });

      const playerNames = {};
      members.forEach(m => playerNames[m.player_id] = m.display_name);

      for (const member of members) {
        const assignedPuzzleId = playerPuzzleMap[member.player_id] || null;
        const assignedPuzzle = assignedPuzzleId ? teamPuzzles.find(p => p.id === assignedPuzzleId) : null;

        const puzzleBoard = teamPuzzles.map(p => ({
          puzzleId: p.id, puzzleType: p.puzzle_type, orderInRound: p.order_in_round,
          initialGrid: JSON.parse(p.initial_grid),
          points: p.points, difficulty: p.difficulty || 'MEDIUM',
          isCompleted: false
        }));

        emissions.push(this._emitUser(member.player_id, 'ROUND2_STARTED', {
          roundId,
          playerOrder,
          playerNames,
          puzzles: puzzleBoard,
          assignedPuzzleId: assignedPuzzleId || null,
          assignedPuzzle: assignedPuzzle ? {
            puzzleId: assignedPuzzle.id, puzzleType: assignedPuzzle.puzzle_type,
            orderInRound: assignedPuzzle.order_in_round,
            initialGrid: JSON.parse(assignedPuzzle.initial_grid),
            currentGrid: JSON.parse(assignedPuzzle.initial_grid),
            points: assignedPuzzle.points, difficulty: assignedPuzzle.difficulty || 'MEDIUM'
          } : null,
          rotationInterval: 60,
          nextRotationAt,
          teamScore: 0,
          solvedCount: 0,
          totalPuzzles: teamPuzzles.length
        }));
      }
    }

    return { result: { roundId, setup: 'ROUND2_RELAY' }, emissions };
  }

  // ─── Submit answer ────────────────────────────────────────────

  async submitAnswer(userId, competitionId, roundId, puzzleId, submissionType, data) {
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

    // Reject wrong submissions early
    if (!isCorrect) {
      emissions.push(this._emitUser(userId, 'ANSWER_RESULT', { roundId, puzzleId, isCorrect: false, pointsEarned: 0, message: 'Incorrect answer, keep trying' }));
      return { result: { puzzleId, isCorrect: false, pointsEarned: 0, message: 'Incorrect answer, keep trying' }, emissions };
    }

    // ── Correct submission ──

    // Validate puzzle is assigned to this player (atomic check)
    const teamState = await this.state.getRound2TeamState(roundId, assignment.team_id);
    const playerPuzzleMap = { ...(teamState?.playerPuzzles || {}) };

    if (playerPuzzleMap[userId] !== puzzleId) {
      emissions.push(this._emitUser(userId, 'ANSWER_RESULT', { roundId, puzzleId, isCorrect: false, pointsEarned: 0, message: 'This puzzle is not assigned to you' }));
      return { result: { puzzleId, isCorrect: false, pointsEarned: 0, message: 'This puzzle is not assigned to you' }, emissions };
    }

    // Duplicate check
    if (assignment.team_id) {
      const teamSolved = await this.repos.submissions.findTeamSolvedPuzzle(roundId, puzzleId, assignment.team_id);
      if (teamSolved) {
        emissions.push(this._emitUser(userId, 'ANSWER_RESULT', { roundId, puzzleId, isCorrect: true, pointsEarned: 0, alreadySolved: true }));
        return { result: { puzzleId, isCorrect: true, pointsEarned: 0, alreadySolved: true }, emissions };
      }
    }

    // Calculate difficulty-based points
    const difficulty = puzzle.difficulty || 'MEDIUM';
    const pointsEarned = this.scoring.getRound2DifficultyPoints(difficulty);

    await this.repos.submissions.create({
      roundId, playerId: userId, puzzleId, teamId: assignment.team_id,
      submissionType: 'FULL_GRID', submittedValue: JSON.stringify(grid),
      isCorrect: true, pointsEarned
    });

    await this.repos.playerStates.markTeamAssignmentsCompleted(roundId, puzzleId, assignment.team_id);

    if (assignment.team_id) {
      this.scoring.addTeamPoints(round.competition_id, roundId, assignment.team_id, pointsEarned);
    }
    this.scoring.addPlayerPoints(round.competition_id, roundId, userId, assignment.team_id, pointsEarned);

    // Atomically release the player's current puzzle assignment
    await this.state.releaseRound2PlayerPuzzle(roundId, assignment.team_id, userId);

    // Mark puzzle as solved in grid map
    await this.state.deleteRound2PuzzleGrid(roundId, assignment.team_id, puzzleId);

    // Assign next unsolved puzzle — using atomic acquire to prevent race conditions
    if (assignment.team_id) {
      const solvedPuzzleIds = await this.repos.submissions.findSolvedPuzzleIds(roundId, assignment.team_id);
      const teamPuzzles = await this.repos.puzzles.findByRoundAndTeam(roundId, assignment.team_id);
      const unsolvedPuzzles = teamPuzzles.filter(p => !solvedPuzzleIds.includes(p.id));

      // Get currently assigned puzzles atomically
      const currentlyAssigned = await this.state.getRound2AssignedPuzzleIds(roundId, assignment.team_id);
      const availablePuzzles = unsolvedPuzzles.filter(p => !currentlyAssigned.has(p.id));

      if (availablePuzzles.length > 0) {
        // Shuffle available puzzles and try acquiring each until one succeeds
        const shuffledAvailable = [...availablePuzzles].sort(() => Math.random() - 0.5);
        let acquiredPuzzle = null;

        for (const candidate of shuffledAvailable) {
          const acquired = await this.state.acquireRound2Puzzle(roundId, assignment.team_id, userId, candidate.id);
          if (acquired) { acquiredPuzzle = candidate; break; }
        }

        if (acquiredPuzzle) {
          await this.repos.playerStates.createAssignment({
            roundId, playerId: userId, puzzleId: acquiredPuzzle.id,
            teamId: assignment.team_id, currentGrid: acquiredPuzzle.initial_grid, isCompleted: false
          });

          // Ensure the puzzle grid is in state
          const puzzleGridMap = { ...(teamState?.puzzleGrids || {}) };
          if (!puzzleGridMap[acquiredPuzzle.id]) {
            puzzleGridMap[acquiredPuzzle.id] = JSON.parse(acquiredPuzzle.initial_grid);
            await this.state.updateRound2PuzzleGrid(roundId, assignment.team_id, acquiredPuzzle.id, puzzleGridMap[acquiredPuzzle.id]);
          }

          emissions.push(this._emitUser(userId, 'ROUND2_PUZZLE_ASSIGNED', {
            roundId, puzzleId: acquiredPuzzle.id,
            puzzleType: acquiredPuzzle.puzzle_type, orderInRound: acquiredPuzzle.order_in_round,
            initialGrid: JSON.parse(acquiredPuzzle.initial_grid),
            currentGrid: JSON.parse(acquiredPuzzle.initial_grid),
            points: acquiredPuzzle.points, difficulty: acquiredPuzzle.difficulty || 'MEDIUM',
            nextRotationAt: teamState?.nextRotationAt || null
          }));
        }
        // If ALL acquires failed (extreme contention), player waits for next rotation
      }

      // Broadcast puzzle solved to team
      const teamScore = this.scoring.findTeamScore(round.competition_id, roundId, assignment.team_id);
      const playerName = await this.repos.users.getDisplayName(userId);
      const solvedCount = solvedPuzzleIds.length;

      // Completion bonus
      let completionBonus = 0;
      const currentRemaining = await this.state.getRemainingSeconds(roundId);
      completionBonus = this.scoring.applyRound2CompletionBonus(
        round.competition_id, roundId, assignment.team_id,
        currentRemaining, solvedCount, teamPuzzles.length
      );

      const updatedTeamScore = this.scoring.findTeamScore(round.competition_id, roundId, assignment.team_id);

      emissions.push(this._emitTeam(round.competition_id, assignment.team_id, 'ROUND2_PUZZLE_SOLVED', {
        roundId, puzzleId, solvedBy: userId, solvedByName: playerName,
        difficulty, puzzlePoints: pointsEarned,
        teamScore: updatedTeamScore?.total_points || 0,
        solvedCount, allSolved: solvedCount >= teamPuzzles.length,
        completionBonus
      }));
    }

    emissions.push(this._emitUser(userId, 'ANSWER_RESULT', { roundId, puzzleId, isCorrect: true, pointsEarned, difficulty }));

    return { result: { puzzleId, isCorrect: true, pointsEarned, difficulty }, emissions };
  }

  // ─── Cell update ──────────────────────────────────────────────

  async cellUpdate(userId, roundId, puzzleId, row, col, value) {
    const emissions = [];
    const teamId = await this.repos.teams.findTeamForPlayerInRound(roundId, userId);
    if (!teamId) throw new Error('未找到你的队伍');

    const teamState = await this.state.getRound2TeamState(roundId, teamId);
    const playerPuzzleMap = teamState?.playerPuzzles || {};
    if (playerPuzzleMap[userId] !== puzzleId) throw new Error('该题目未分配给你');

    const assignment = await this.repos.playerStates.findAnyAssignment(roundId, userId, puzzleId);
    if (!assignment) throw new Error('题目未分配给你');

    let currentGrid;
    try {
      currentGrid = JSON.parse(assignment.current_grid || '[]');
    } catch (e) {
      const puzzle = await this.repos.puzzles.findById(puzzleId);
      currentGrid = JSON.parse(puzzle?.initial_grid || '[]');
    }

    if (currentGrid && currentGrid[row] !== undefined) {
      currentGrid[row][col] = value;
    }

    await this.repos.playerStates.updateCurrentGrid(assignment.id, JSON.stringify(currentGrid));

    // Use granular grid update instead of full setRound2TeamState()
    await this.state.updateRound2PuzzleGrid(roundId, teamId, puzzleId, currentGrid);

    const round = await this.repos.rounds.findById(roundId);
    const playerName = await this.repos.users.getDisplayName(userId);
    if (round && teamId) {
      emissions.push(this._emitTeam(round.competition_id, teamId, 'ROUND2_PUZZLE_UPDATED', {
        roundId, puzzleId, row, col, value,
        updatedBy: userId, updatedByName: playerName, currentGrid
      }));
    }

    return { result: { success: true }, emissions };
  }

  // ─── Rotation ─────────────────────────────────────────────────

  async rotatePuzzles(competitionId, roundId, teamId) {
    const emissions = [];
    const teamState = await this.state.getRound2TeamState(roundId, teamId);
    if (!teamState || !teamState.playerOrder || teamState.playerOrder.length === 0) return { result: null, emissions };

    const playerPuzzleMap = { ...teamState.playerPuzzles };
    const puzzleGridMap = { ...teamState.puzzleGrids };
    const playerOrder = teamState.playerOrder;

    // Save current grid states before rotation
    for (const [playerId, puzzleId] of Object.entries(playerPuzzleMap)) {
      const assignment = await this.repos.playerStates.findActiveAssignment(roundId, Number(playerId), puzzleId);
      if (assignment?.current_grid) {
        try { puzzleGridMap[puzzleId] = JSON.parse(assignment.current_grid); } catch (e) { /* keep existing */ }
      }
    }

    // Collect and rotate puzzle assignments
    const assignedPuzzleIds = playerOrder.map(pid => playerPuzzleMap[pid]).filter(Boolean);
    const rotatedPuzzleIds = [];
    if (assignedPuzzleIds.length > 0) {
      rotatedPuzzleIds.push(assignedPuzzleIds[assignedPuzzleIds.length - 1]);
      for (let i = 0; i < assignedPuzzleIds.length - 1; i++) {
        rotatedPuzzleIds.push(assignedPuzzleIds[i]);
      }
    }

    // Atomically release all current assignments
    for (const playerId of playerOrder) {
      const oldPuzzleId = playerPuzzleMap[playerId];
      if (oldPuzzleId) await this.repos.playerStates.deleteUncompletedAssignment(roundId, playerId, oldPuzzleId);
      await this.state.releaseRound2PlayerPuzzle(roundId, teamId, playerId);
    }

    const nextRotationAt = Date.now() + 60000;

    // Atomically acquire new rotated assignments
    const unassignedAfterRotation = [];

    for (let i = 0; i < playerOrder.length; i++) {
      const playerId = playerOrder[i];
      if (i < rotatedPuzzleIds.length) {
        const newPuzzleId = rotatedPuzzleIds[i];
        const newGrid = puzzleGridMap[newPuzzleId];
        const gridJSON = newGrid ? JSON.stringify(newGrid) : null;

        // Atomic acquire — prevents conflict with concurrent submitAnswer
        const acquired = await this.state.acquireRound2Puzzle(roundId, teamId, playerId, newPuzzleId);

        if (acquired) {
          await this.repos.playerStates.createAssignment({
            roundId, playerId, puzzleId: newPuzzleId,
            teamId, currentGrid: gridJSON || '[]', isCompleted: false
          });

          // Persist grid for this puzzle
          if (newGrid) {
            await this.state.updateRound2PuzzleGrid(roundId, teamId, newPuzzleId, newGrid);
          }

          const puzzle = await this.repos.puzzles.findById(newPuzzleId);
          if (puzzle) {
            emissions.push(this._emitUser(playerId, 'ROUND2_PUZZLE_ASSIGNED', {
              roundId, puzzleId: newPuzzleId,
              puzzleType: puzzle.puzzle_type, orderInRound: puzzle.order_in_round,
              initialGrid: JSON.parse(puzzle.initial_grid),
              currentGrid: newGrid || JSON.parse(puzzle.initial_grid),
              points: puzzle.points, difficulty: puzzle.difficulty || 'MEDIUM',
              nextRotationAt
            }));
          }
        } else {
          // Acquire failed (concurrent submitAnswer stole this puzzle)
          unassignedAfterRotation.push(playerId);
        }
      } else {
        // No rotated puzzle available for this player (more players than rotating puzzles)
        unassignedAfterRotation.push(playerId);
      }
    }

    // Gap-fill: assign any players left without a puzzle after rotation
    if (unassignedAfterRotation.length > 0) {
      const solvedPuzzleIds = await this.repos.submissions.findSolvedPuzzleIds(roundId, teamId);
      const allTeamPuzzles = await this.repos.puzzles.findByRoundAndTeam(roundId, teamId);
      const unsolvedPuzzles = allTeamPuzzles.filter(p => !solvedPuzzleIds.includes(p.id));

      const currentlyAssigned = await this.state.getRound2AssignedPuzzleIds(roundId, teamId);
      const availableForGapFill = unsolvedPuzzles.filter(p => !currentlyAssigned.has(p.id));

      const shuffledGapFill = [...availableForGapFill].sort(() => Math.random() - 0.5);
      let gapIdx = 0;

      for (const playerId of unassignedAfterRotation) {
        if (gapIdx >= shuffledGapFill.length) break;

        let acquiredForGap = null;
        for (let g = gapIdx; g < shuffledGapFill.length; g++) {
          const candidate = shuffledGapFill[g];
          const acquired = await this.state.acquireRound2Puzzle(roundId, teamId, playerId, candidate.id);
          if (acquired) {
            acquiredForGap = candidate;
            gapIdx = g + 1;
            break;
          }
        }

        if (acquiredForGap) {
          await this.repos.playerStates.createAssignment({
            roundId, playerId, puzzleId: acquiredForGap.id,
            teamId, currentGrid: acquiredForGap.initial_grid, isCompleted: false
          });

          if (!puzzleGridMap[acquiredForGap.id]) {
            puzzleGridMap[acquiredForGap.id] = JSON.parse(acquiredForGap.initial_grid);
            await this.state.updateRound2PuzzleGrid(roundId, teamId, acquiredForGap.id, puzzleGridMap[acquiredForGap.id]);
          }

          emissions.push(this._emitUser(playerId, 'ROUND2_PUZZLE_ASSIGNED', {
            roundId, puzzleId: acquiredForGap.id,
            puzzleType: acquiredForGap.puzzle_type, orderInRound: acquiredForGap.order_in_round,
            initialGrid: JSON.parse(acquiredForGap.initial_grid),
            currentGrid: JSON.parse(acquiredForGap.initial_grid),
            points: acquiredForGap.points, difficulty: acquiredForGap.difficulty || 'MEDIUM',
            nextRotationAt
          }));
        }
      }
    }

    // Update only the rotation timestamp (not the full state)
    await this.state.setRound2NextRotation(roundId, teamId, nextRotationAt);

    // Reschedule 5-second pre-rotation notification for next rotation
    if (this.r2Notification) {
      this.r2Notification.scheduleRotationNotification(
        competitionId, roundId, teamId, nextRotationAt,
        (tournId, rId, tId) => {
          const emission = this._emitTeam(tournId, tId, 'ROUND2_ROTATION_WARNING', {
            roundId: rId, secondsUntilRotation: 5
          });
          if (this._onEmission) this._onEmission(emission);
        }
      );
    }

    // Broadcast rotation event
    const playerNames = await this.repos.teams.getPlayerNames(teamId);
    const teamScore = this.scoring.findTeamScore(competitionId, roundId, teamId);
    const solvedPuzzleIds = await this.repos.submissions.findSolvedPuzzleIds(roundId, teamId);

    // Read current assignments for broadcast (reflects any concurrent submitAnswer changes)
    const currentState = await this.state.getRound2TeamState(roundId, teamId);
    const currentAssignments = currentState?.playerPuzzles || {};

    emissions.push(this._emitTeam(competitionId, teamId, 'ROUND2_ROTATION', {
      roundId, playerOrder, playerNames,
      assignments: currentAssignments,
      nextRotationAt,
      teamScore: teamScore?.total_points || 0,
      solvedCount: solvedPuzzleIds.length
    }));

    return { result: { rotated: true }, emissions };
  }

  // ─── Start rotation intervals ─────────────────────────────────

  startRotationIntervals(competitionId, roundId, teams, onRotate) {
    for (const team of teams) {
      const k = this._r2k(roundId, team.id);
      const rotInterval = setInterval(() => {
        onRotate(competitionId, roundId, team.id);
      }, 60000);
      this._rotIntervals.set(k, rotInterval);

      // Schedule 5-second pre-rotation notification
      if (this.r2Notification) {
        const teamState = this.state.getRound2TeamState(roundId, team.id);
        // Schedule for the first rotation — get nextRotationAt from state
        this._scheduleNotification(competitionId, roundId, team.id);
      }
    }
  }

  /**
   * Schedule rotation notification for a team based on current nextRotationAt.
   * @param {number} competitionId
   * @param {number} roundId
   * @param {number} teamId
   */
  _scheduleNotification(competitionId, roundId, teamId) {
    if (!this.r2Notification) return;

    this.state.getRound2TeamState(roundId, teamId).then(teamState => {
      if (teamState?.nextRotationAt) {
        this.r2Notification.scheduleRotationNotification(
          competitionId, roundId, teamId, teamState.nextRotationAt,
          (tournId, rId, tId) => {
            // Emit ROUND2_ROTATION_WARNING to the team
            const emission = this._emitTeam(tournId, tId, 'ROUND2_ROTATION_WARNING', {
              roundId: rId, secondsUntilRotation: 5
            });
            // Emissions from notifications need to be processed by the orchestrator
            if (this._onEmission) this._onEmission(emission);
          }
        );
      }
    });
  }

  /**
   * Set callback for emissions from notification service.
   * @param {Function} cb
   */
  setEmissionCallback(cb) {
    this._onEmission = cb;
  }

  clearRotationIntervals(roundId, teams) {
    for (const team of teams) {
      const k = this._r2k(roundId, team.id);
      const rotTimer = this._rotIntervals.get(k);
      if (rotTimer) { clearInterval(rotTimer); this._rotIntervals.delete(k); }
    }
    // Clear rotation notifications
    if (this.r2Notification) {
      this.r2Notification.clearNotifications(roundId, teams);
    }
  }

  clearAllRotationIntervals() {
    for (const [, interval] of this._rotIntervals) clearInterval(interval);
    this._rotIntervals.clear();
    if (this.r2Notification) {
      this.r2Notification.clearAllNotifications();
    }
  }

  // ─── Reconnect state ──────────────────────────────────────────

  async getReconnectState(userId, competitionId, roundId) {
    const member = await this.repos.teams.findMemberTeam(competitionId, userId);
    if (!member) return null;

    const teamState = await this.state.getRound2TeamState(roundId, member.team_id);
    const teamPuzzles = await this.repos.puzzles.findByRoundAndTeam(roundId, member.team_id);
    const solvedPuzzleIds = await this.repos.submissions.findSolvedPuzzleIds(roundId, member.team_id);
    const solvedIds = new Set(solvedPuzzleIds);
    const teamScore = this.scoring.findTeamScore(competitionId, roundId, member.team_id);
    const playerNames = await this.repos.teams.getPlayerNames(member.team_id);

    const playerPuzzles = teamState?.playerPuzzles || {};
    const puzzleGrids = teamState?.puzzleGrids || {};
    const playerOrder = teamState?.playerOrder || [];

    const puzzleBoard = teamPuzzles.map(p => ({
      puzzleId: p.id, puzzleType: p.puzzle_type, orderInRound: p.order_in_round,
      initialGrid: JSON.parse(p.initial_grid),
      points: p.points, difficulty: p.difficulty || 'MEDIUM',
      isCompleted: solvedIds.has(p.id)
    }));

    const assignedPuzzleId = playerPuzzles[userId] || null;
    let assignedPuzzle = null;
    if (assignedPuzzleId) {
      const ap = teamPuzzles.find(p => p.id === assignedPuzzleId);
      const currentGrid = puzzleGrids[assignedPuzzleId] || JSON.parse(ap?.initial_grid || '[]');
      if (ap) {
        assignedPuzzle = {
          puzzleId: ap.id, puzzleType: ap.puzzle_type, orderInRound: ap.order_in_round,
          initialGrid: JSON.parse(ap.initial_grid), currentGrid,
          points: ap.points, difficulty: ap.difficulty || 'MEDIUM'
        };
      }
    }

    return {
      playerOrder,
      playerNames,
      puzzles: puzzleBoard,
      assignedPuzzleId,
      assignedPuzzle,
      rotationInterval: 60,
      nextRotationAt: teamState?.nextRotationAt || null,
      teamScore: teamScore?.total_points || 0,
      solvedCount: solvedIds.size,
      totalPuzzles: teamPuzzles.length,
      allSolved: solvedIds.size >= teamPuzzles.length && teamPuzzles.length > 0
    };
  }

  async getTeamState(roundId, teamId) {
    return this.state.getRound2TeamState(roundId, teamId);
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  async cleanup(competitionId, roundId) {
    const teams = await this.repos.teams.findByCompetition(competitionId);
    this.clearRotationIntervals(roundId, teams);
    for (const team of teams) {
      await this.state.deleteRound2TeamState(roundId, team.id);
    }
  }
}

module.exports = Round2Engine;
