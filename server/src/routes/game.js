const express = require('express');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

function createGameRouter(repos, orchestrator) {
  const router = express.Router();

  // Helper: process emissions from orchestrator methods
  function handleOrchestratorResult(result) {
    if (result && result.emissions) {
      orchestrator.processEmissions(result.emissions);
    }
    return result?.result || result;
  }

  // List stages with rounds
  router.get('/competitions/:id/stages', authMiddleware, async (req, res) => {
    try {
      const stages = await orchestrator.listStages(req.params.id);
      res.json({ code: 200, message: 'success', data: stages });
    } catch (e) {
      res.json({ code: 40040, message: e.message, data: null });
    }
  });

  // Configure stage order and types
  router.put('/competitions/:id/stages', authMiddleware, roleMiddleware('JUDGE', 'ADMIN'), async (req, res) => {
    try {
      const stages = await orchestrator.configureStages(req.params.id, req.body.stages);
      res.json({ code: 200, message: 'success', data: stages });
    } catch (e) {
      res.json({ code: 40040, message: e.message, data: null });
    }
  });

  // Start tournament
  router.post('/tournaments/:id/start', authMiddleware, roleMiddleware('JUDGE', 'ADMIN'), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.startTournament(req.params.id));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      res.json({ code: 40040, message: e.message, data: null });
    }
  });

  // Start stage
  router.post('/competitions/:competitionId/stages/:stageId/start', authMiddleware, roleMiddleware('JUDGE', 'ADMIN'), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.startStage(req.params.competitionId, req.params.stageId));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      res.json({ code: 40040, message: e.message, data: null });
    }
  });

  // Start round
  router.post('/tournaments/:id/rounds/:roundId/start', authMiddleware, roleMiddleware('JUDGE', 'ADMIN'), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.startRound(parseInt(req.params.id), parseInt(req.params.roundId)));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      res.json({ code: 40040, message: e.message, data: null });
    }
  });

  // Pause tournament
  router.post('/tournaments/:id/pause', authMiddleware, roleMiddleware('JUDGE', 'ADMIN'), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.pauseTournament(parseInt(req.params.id)));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      res.json({ code: 40040, message: e.message, data: null });
    }
  });

  // Resume tournament
  router.post('/tournaments/:id/resume', authMiddleware, roleMiddleware('JUDGE', 'ADMIN'), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.resumeTournament(parseInt(req.params.id)));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      res.json({ code: 40040, message: e.message, data: null });
    }
  });

  // End round
  router.post('/tournaments/:id/rounds/:roundId/end', authMiddleware, roleMiddleware('JUDGE', 'ADMIN'), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.endRound(parseInt(req.params.id), parseInt(req.params.roundId)));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      res.json({ code: 40040, message: e.message, data: null });
    }
  });

  // End tournament
  router.post('/tournaments/:id/end', authMiddleware, roleMiddleware('JUDGE', 'ADMIN'), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.endTournament(parseInt(req.params.id)));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      res.json({ code: 40040, message: e.message, data: null });
    }
  });

  // Submit answer
  router.post('/submissions', authMiddleware, roleMiddleware('PLAYER'), async (req, res) => {
    try {
      const { roundId, puzzleId, submissionType, row, col, value, grid } = req.body;
      const { result, emissions } = await orchestrator.submitAnswer(req.user.userId, roundId, puzzleId, submissionType, { row, col, value, grid });
      orchestrator.processEmissions(emissions);
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      res.json({ code: 40050, message: e.message, data: null });
    }
  });

  // Get my scores
  router.get('/tournaments/:id/scores/my', authMiddleware, roleMiddleware('PLAYER'), async (req, res) => {
    const scores = await repos.scores.findPlayerScoresByTournament(req.params.id, req.user.userId);
    res.json({ code: 200, message: 'success', data: scores });
  });

  // Get team scores
  router.get('/tournaments/:id/scores/teams', authMiddleware, async (req, res) => {
    const scores = await repos.scores.findTeamScoresByTournament(req.params.id);
    res.json({ code: 200, message: 'success', data: scores });
  });

  // Get room status
  router.get('/tournaments/:id/room/status', authMiddleware, roleMiddleware('JUDGE', 'ADMIN'), async (req, res) => {
    const tournament = await repos.tournaments.findById(req.params.id);
    if (!tournament) return res.json({ code: 40400, message: '比赛不存在', data: null });
    const currentRound = await repos.rounds.findByTournamentAndStatus(req.params.id, 'IN_PROGRESS');
    const teams = await repos.teams.findByTournamentWithMembers(req.params.id);
    res.json({
      code: 200, message: 'success', data: {
        tournamentId: tournament.id,
        status: tournament.status,
        currentRound,
        teams
      }
    });
  });

  // Get player's current game state (REST fallback for late-join / refresh)
  router.get('/tournaments/:id/my-state', authMiddleware, roleMiddleware('PLAYER'), async (req, res) => {
    const tournament = await repos.tournaments.findById(req.params.id);
    if (!tournament) return res.json({ code: 40400, message: '比赛不存在', data: null });

    const activeRound = await repos.tournaments.findActiveRound(req.params.id);

    if (!activeRound) {
      return res.json({
        code: 200, message: 'success', data: {
          tournamentStatus: tournament.status,
          currentRound: null,
          puzzles: []
        }
      });
    }

    const assignments = await repos.playerStates.findPlayerAssignments(activeRound.id, req.user.userId);

    const remaining = await orchestrator.getRemainingSeconds(activeRound.id) ?? activeRound.remaining_seconds ?? 0;

    // Get full timer state for server-authoritative timestamps
    const timerState = await orchestrator.state.getRoundTimer(activeRound.id);

    const playerPuzzles = assignments.map(p => {
      const isFinal = p.puzzle_type === 'FINAL';
      return {
        puzzleId: p.id,
        puzzleType: p.puzzle_type,
        orderInRound: p.order_in_round,
        initialGrid: JSON.parse(p.initial_grid),
        currentGrid: p.current_grid ? JSON.parse(p.current_grid) : null,
        points: p.points,
        letter: p.letter,
        isFinal: isFinal,
        isLocked: isFinal
      };
    });

    // Round 1 specific: include team progress
    let round1Progress = null;
    if (activeRound.round_type === 'ROUND1_NINE_ONE') {
      const member = await repos.teams.findMemberTeam(req.params.id, req.user.userId);
      if (member) {
        const teamSolved = await repos.submissions.findTeamJocCorrect(activeRound.id, member.team_id);
        const allTeamCorrect = await repos.submissions.findTeamCorrect(activeRound.id, member.team_id);
        const teamJocCount = await repos.puzzles.countTeamJoc(activeRound.id, member.team_id);
        const allSolved = teamSolved.length >= teamJocCount && teamJocCount > 0;

        const finalActuallySolved = allTeamCorrect.some(s => s.puzzle_type === 'FINAL');

        const clues = teamSolved.sort((a, b) => a.order_in_round - b.order_in_round).map(s => ({ puzzleId: s.puzzle_id, letter: s.letter, orderInRound: s.order_in_round }));
        const teamScore = await repos.scores.findTeamScore(req.params.id, activeRound.id, member.team_id);

        const fp = await repos.puzzles.findTeamFinalPuzzle(activeRound.id, member.team_id);

        round1Progress = {
          solvedPuzzleIds: allTeamCorrect.map(s => s.puzzle_id),
          clues,
          jocSolvedCount: teamSolved.length,
          jocTotalCount: teamJocCount,
          finalUnlocked: allSolved,
          finalSolved: finalActuallySolved,
          finalPuzzleId: fp?.id || null,
          teamScore: teamScore?.total_points || 0
        };

        if (allSolved && fp) {
          const finalInList = playerPuzzles.find(p => p.puzzleId === fp.id);
          if (finalInList) {
            finalInList.isLocked = false;
          }
        }
      }
    }

    // Round 2 specific: include puzzle assignment and board state
    let round2State = null;
    if (activeRound.round_type === 'ROUND2_RELAY') {
      const member = await repos.teams.findMemberTeam(req.params.id, req.user.userId);
      if (member) {
        const teamState = await orchestrator.getRound2TeamState(activeRound.id, member.team_id);
        const playerPuzzleMap = teamState?.playerPuzzles || {};
        const puzzleGridMap = teamState?.puzzleGrids || {};
        const playerOrder = teamState?.playerOrder || [];

        const teamPuzzles = await repos.puzzles.findByRoundAndTeam(activeRound.id, member.team_id);

        const solvedPuzzleIds = await repos.submissions.findSolvedPuzzleIds(activeRound.id, member.team_id);
        const solvedIds = new Set(solvedPuzzleIds);

        const teamScore = await repos.scores.findTeamScore(req.params.id, activeRound.id, member.team_id);

        const playerNames = await repos.teams.getPlayerNames(member.team_id);

        const puzzleBoard = teamPuzzles.map(p => ({
          puzzleId: p.id,
          puzzleType: p.puzzle_type,
          orderInRound: p.order_in_round,
          initialGrid: JSON.parse(p.initial_grid),
          points: p.points,
          difficulty: p.difficulty || 'MEDIUM',
          isCompleted: solvedIds.has(p.id)
        }));

        const assignedPuzzleId = playerPuzzleMap[req.user.userId] || null;
        let assignedPuzzle = null;
        if (assignedPuzzleId) {
          const ap = teamPuzzles.find(p => p.id === assignedPuzzleId);
          const currentGrid = puzzleGridMap[assignedPuzzleId] || JSON.parse(ap?.initial_grid || '[]');
          if (ap) {
            assignedPuzzle = {
              puzzleId: ap.id,
              puzzleType: ap.puzzle_type,
              orderInRound: ap.order_in_round,
              initialGrid: JSON.parse(ap.initial_grid),
              currentGrid,
              points: ap.points,
              difficulty: ap.difficulty || 'MEDIUM'
            };
          }
        }

        round2State = {
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
    }

    // Round 3 specific: include collaboration state
    let round3State = null;
    if (activeRound.round_type === 'ROUND3_COLLABORATE') {
      const member = await repos.teams.findMemberTeam(req.params.id, req.user.userId);
      if (member) {
        const teamPuzzles = await repos.puzzles.findByRoundAndTeam(activeRound.id, member.team_id);
        const solvedPuzzleIds = await repos.submissions.findSolvedPuzzleIds(activeRound.id, member.team_id);
        const solvedIds = new Set(solvedPuzzleIds);
        const teamScore = await repos.scores.findTeamScore(req.params.id, activeRound.id, member.team_id);

        // Get current puzzle
        const assignment = await repos.playerStates.findActiveAssignment(activeRound.id, req.user.userId, null);
        const currentPuzzleId = assignment?.puzzle_id || (teamPuzzles.length > 0 ? teamPuzzles[0].id : null);

        const puzzleList = teamPuzzles.map(p => ({
          puzzleId: p.id,
          puzzleType: p.puzzle_type,
          orderInRound: p.order_in_round,
          initialGrid: JSON.parse(p.initial_grid),
          points: p.points,
          difficulty: p.difficulty || 'EASY',
          letter: p.letter || null,
          isCompleted: solvedIds.has(p.id)
        }));

        // Get collaboration state
        let cells = {};
        let suggestions = {};
        let playerFocuses = {};
        let suggestionVotes = {};
        if (currentPuzzleId) {
          cells = await orchestrator.state.getRound3Cells(currentPuzzleId);
          if (orchestrator.r3Collaboration) {
            const collabState = await orchestrator.r3Collaboration.getPuzzleState(currentPuzzleId);
            suggestions = collabState.suggestions;
            playerFocuses = collabState.playerFocuses;
            suggestionVotes = collabState.suggestionVotes;
          }
        }

        // Build teamMembers list with online status
        const allTeamMembers = await repos.teams.getMembersWithDetails(member.team_id);
        const activePlayers = await orchestrator.state.getActivePlayers(req.params.id);
        const teamMembers = (allTeamMembers || []).map(m => ({
          playerId: String(m.player_id),
          playerName: m.display_name || `Player ${m.player_id}`,
          online: !!activePlayers[String(m.player_id)]
        }));

        round3State = {
          puzzles: puzzleList,
          currentPuzzleId,
          cells,
          suggestions,
          playerFocuses,
          suggestionVotes,
          teamMembers,
          teamScore: teamScore?.total_points || 0,
          solvedCount: solvedIds.size,
          totalPuzzles: teamPuzzles.length
        };
      }
    }

    res.json({
      code: 200, message: 'success', data: {
        tournamentStatus: tournament.status,
        currentRound: {
          roundId: activeRound.id,
          roundNumber: activeRound.round_number,
          roundName: activeRound.name,
          roundType: activeRound.round_type,
          durationSeconds: activeRound.duration_seconds,
          remainingSeconds: remaining,
          turnEndsAt: timerState?.turnEndsAt || null,
          timerStatus: timerState?.status || 'UNKNOWN',
          pausedAt: timerState?.pausedAt || null,
          remainingAtPause: timerState?.remainingAtPause || null,
          totalPuzzles: assignments.length
        },
        puzzles: playerPuzzles,
        round1Progress,
        round2State,
        round3State
      }
    });
  });

  return router;
}

module.exports = { createGameRouter };
