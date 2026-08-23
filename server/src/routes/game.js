const express = require('express');
const { authMiddleware, roleMiddleware, ADMIN_ROLES } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { validateBody } = require('../middleware/validate');
const { submitAnswerSchema } = require('../validations/game');
const { GameError } = require('../engine/errors');
const logger = require('../utils/logger');

// Phase 10 of the second migration chantier: re-enabled with /competitions paths,
// UUID-safe params (no parseInt), and tenantGuard('competitions') on every route
// that carries a competition :id. The orchestrator method names
// (startCompetition, pauseCompetition, etc.) are NOT renamed — only the HTTP paths
// and internal variables change. See JOURNAL_MODIFICATIONS PARTIE 2.

function createGameRouter(repos, orchestrator) {
  const router = express.Router();

  /**
   * Sanitize errors from orchestrator methods.
   * GameError instances carry safe Chinese messages for the client.
   * All other errors are logged with their stack trace but returned as
   * generic "操作失败" so internals don't leak.
   */
  function sanitizeError(e) {
    if (e instanceof GameError) {
      return { code: _gameErrorCode(e), message: e.message };
    }
    logger.error('[game] Unmapped error', { error: e.message, stack: e.stack });
    return { code: 50000, message: '操作失败，请稍后重试' };
  }

  function _gameErrorCode(e) {
    const name = e.name || '';
    if (name === 'CompetitionError') return 4040;
    if (name === 'StageError') return 40040;
    if (name === 'RoundError') return 40040;
    if (name === 'PlayerError') return 40301;
    if (name === 'SubmissionError') return 40050;
    if (name === 'PuzzleError') return 40040;
    if (name === 'StateError') return 40040;
    return 40040;
  }

  // Helper: process emissions from orchestrator methods
  function handleOrchestratorResult(result) {
    if (result && result.emissions) {
      orchestrator.processEmissions(result.emissions);
    }
    return result?.result || result;
  }

  // List stages with rounds
  router.get('/competitions/:id/stages', authMiddleware, tenantGuard('competitions'), async (req, res) => {
    try {
      const stages = await orchestrator.listStages(req.params.id);
      res.json({ code: 200, message: 'success', data: stages });
    } catch (e) {
      const err = sanitizeError(e);
      res.json({ code: err.code, message: err.message, data: null });
    }
  });

  // Configure stage order and types
  router.put('/competitions/:id/stages', authMiddleware, tenantGuard('competitions'), roleMiddleware('JUDGE', ...ADMIN_ROLES), async (req, res) => {
    try {
      const stages = await orchestrator.configureStages(req.params.id, req.body.stages);
      res.json({ code: 200, message: 'success', data: stages });
    } catch (e) {
      const err = sanitizeError(e);
      res.json({ code: err.code, message: err.message, data: null });
    }
  });

  // Start competition
  router.post('/competitions/:id/start', authMiddleware, tenantGuard('competitions'), roleMiddleware('JUDGE', ...ADMIN_ROLES), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.startCompetition(req.params.id));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      const err = sanitizeError(e);
      res.json({ code: err.code, message: err.message, data: null });
    }
  });

  // Start stage
  router.post('/competitions/:competitionId/stages/:stageId/start', authMiddleware, tenantGuard('competitions', { param: 'competitionId' }), roleMiddleware('JUDGE', ...ADMIN_ROLES), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.startStage(req.params.competitionId, req.params.stageId));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      const err = sanitizeError(e);
      res.json({ code: err.code, message: err.message, data: null });
    }
  });

  // Start round
  router.post('/competitions/:id/rounds/:roundId/start', authMiddleware, tenantGuard('competitions'), roleMiddleware('JUDGE', ...ADMIN_ROLES), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.startRound(req.params.id, req.params.roundId));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      const err = sanitizeError(e);
      res.json({ code: err.code, message: err.message, data: null });
    }
  });

  // Pause competition
  router.post('/competitions/:id/pause', authMiddleware, tenantGuard('competitions'), roleMiddleware('JUDGE', ...ADMIN_ROLES), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.pauseCompetition(req.params.id));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      const err = sanitizeError(e);
      res.json({ code: err.code, message: err.message, data: null });
    }
  });

  // Resume competition
  router.post('/competitions/:id/resume', authMiddleware, tenantGuard('competitions'), roleMiddleware('JUDGE', ...ADMIN_ROLES), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.resumeCompetition(req.params.id));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      const err = sanitizeError(e);
      res.json({ code: err.code, message: err.message, data: null });
    }
  });

  // End round
  router.post('/competitions/:id/rounds/:roundId/end', authMiddleware, tenantGuard('competitions'), roleMiddleware('JUDGE', ...ADMIN_ROLES), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.endRound(req.params.id, req.params.roundId));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      const err = sanitizeError(e);
      res.json({ code: err.code, message: err.message, data: null });
    }
  });

  // Transition to next stage (judge-triggered: after current stage finishes, start the next)
  router.post('/competitions/:id/stages/next', authMiddleware, tenantGuard('competitions'), roleMiddleware('JUDGE', ...ADMIN_ROLES), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.startNextStage(req.params.id));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      const err = sanitizeError(e);
      res.json({ code: err.code, message: err.message, data: null });
    }
  });

  // End competition
  router.post('/competitions/:id/end', authMiddleware, tenantGuard('competitions'), roleMiddleware('JUDGE', ...ADMIN_ROLES), async (req, res) => {
    try {
      const result = handleOrchestratorResult(await orchestrator.endCompetition(req.params.id));
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      const err = sanitizeError(e);
      res.json({ code: err.code, message: err.message, data: null });
    }
  });

  // Submit answer
  router.post('/submissions', authMiddleware, roleMiddleware('PLAYER'), validateBody(submitAnswerSchema), async (req, res) => {
    try {
      const { roundId, puzzleId, submissionType, row, col, value, grid } = req.body;
      const { result, emissions } = await orchestrator.submitAnswer(req.user.userId, roundId, puzzleId, submissionType, { row, col, value, grid });
      orchestrator.processEmissions(emissions);
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      const err = sanitizeError(e);
      res.json({ code: err.code, message: err.message, data: null });
    }
  });

  // Individual round submission (server-authoritative scoring)
  router.post('/submissions/individual', authMiddleware, roleMiddleware('PLAYER'), async (req, res) => {
    try {
      const { competitionId, roundId, puzzleId, grid } = req.body;
      const { result, emissions } = await orchestrator.submitAnswer(
        req.user.userId,
        roundId,
        puzzleId,
        'INDIVIDUAL',
        { grid, competitionId }
      );
      orchestrator.processEmissions(emissions);
      res.json({ code: 200, message: 'success', data: result });
    } catch (e) {
      const err = sanitizeError(e);
      res.json({ code: err.code, message: err.message, data: null });
    }
  });

  // Get my scores
  router.get('/competitions/:id/scores/my', authMiddleware, tenantGuard('competitions'), roleMiddleware('PLAYER'), async (req, res) => {
    const scores = await repos.scores.findPlayerScoresByCompetition(req.params.id, req.user.userId);
    res.json({ code: 200, message: 'success', data: scores });
  });

  // Get team scores
  router.get('/competitions/:id/scores/teams', authMiddleware, tenantGuard('competitions'), async (req, res) => {
    const scores = await repos.scores.findTeamScoresByCompetition(req.params.id);
    res.json({ code: 200, message: 'success', data: scores });
  });

  // Get room status
  router.get('/competitions/:id/room/status', authMiddleware, tenantGuard('competitions'), roleMiddleware('JUDGE', ...ADMIN_ROLES), async (req, res) => {
    const competition = await repos.competitions.findById(req.params.id);
    if (!competition) return res.json({ code: 40400, message: '比赛不存在', data: null });
    const currentRound = await repos.rounds.findByCompetitionAndStatus(req.params.id, 'IN_PROGRESS');
    const teams = await repos.teams.findByCompetitionWithMembers(req.params.id);

    // The judge console reads currentRound.remaining_seconds to show the
    // countdown. The old schema stored it as a column on `rounds`; the UUID
    // migration dropped it and moved timing to the application layer, which
    // left the console permanently blank. Re-attach it from the live timer.
    if (currentRound) {
      currentRound.remaining_seconds = await orchestrator.getRemainingSeconds(currentRound.id);
    }

    res.json({
      code: 200, message: 'success', data: {
        competitionId: competition.id,
        status: competition.status,
        currentRound,
        teams
      }
    });
  });

  // Get player's current game state (REST fallback for late-join / refresh)
  router.get('/competitions/:id/my-state', authMiddleware, tenantGuard('competitions'), roleMiddleware('PLAYER'), async (req, res) => {
    const competition = await repos.competitions.findById(req.params.id);
    if (!competition) return res.json({ code: 40400, message: '比赛不存在', data: null });

    const activeRound = await repos.competitions.findActiveRound(req.params.id);

    if (!activeRound) {
      return res.json({
        code: 200, message: 'success', data: {
          competitionStatus: competition.status,
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
        competitionStatus: competition.status,
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
