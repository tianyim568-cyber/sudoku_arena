const express = require('express');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  createTournamentSchema,
  createRoundSchema,
  updateTournamentSchema,
  createTeamSchema,
  addTeamMemberSchema,
  assignJudgeSchema,
} = require('../validations/tournaments');

function createTournamentRouter(repos) {
  const router = express.Router();

  // Create tournament
  router.post('/tournaments', authMiddleware, roleMiddleware('ADMIN'), validate(createTournamentSchema), async (req, res) => {
    const { name, description, scheduledTime } = req.body;
    const t = await repos.tournaments.create({ name, description: description || '', scheduledTime, createdBy: req.user.userId });
    res.json({ code: 200, message: 'success', data: t });
  });

  // List tournaments
  router.get('/tournaments', authMiddleware, async (req, res) => {
    const ts = await repos.tournaments.findAll();
    res.json({ code: 200, message: 'success', data: ts });
  });

  // Get tournament detail
  router.get('/tournaments/:id', authMiddleware, async (req, res) => {
    const t = await repos.tournaments.findById(req.params.id);
    if (!t) return res.json({ code: 40400, message: '比赛不存在', data: null });
    const rounds = await repos.rounds.findWithPuzzles(req.params.id);
    const teams = await repos.teams.findByTournamentWithMemberCount(req.params.id);
    for (const tm of teams) {
      tm.members = await repos.teams.getMembers(tm.id);
    }
    const judges = await repos.teams.getJudges(req.params.id);
    res.json({ code: 200, message: 'success', data: { ...t, rounds, teams, judges } });
  });

  // Delete tournament (PENDING or FINISHED only, ADMIN only)
  router.delete('/tournaments/:id', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
    const t = await repos.tournaments.findById(req.params.id);
    if (!t) return res.json({ code: 40400, message: '比赛不存在', data: null });
    if (t.status === 'IN_PROGRESS' || t.status === 'PAUSED') {
      return res.json({ code: 40041, message: '比赛进行中，无法删除，请先结束比赛', data: null });
    }

    await repos.tournaments.deleteCascade(req.params.id);
    res.json({ code: 200, message: 'success', data: { deleted: req.params.id } });
  });

  // Update tournament
  router.put('/tournaments/:id', authMiddleware, roleMiddleware('ADMIN'), validate(updateTournamentSchema), async (req, res) => {
    const t = await repos.tournaments.findById(req.params.id);
    if (!t) return res.json({ code: 40400, message: '比赛不存在', data: null });
    if (t.status !== 'PENDING') return res.json({ code: 40041, message: '比赛已开始，无法修改', data: null });
    const { name, description, scheduledTime } = req.body;
    const updated = await repos.tournaments.update(req.params.id, { name, description, scheduledTime });
    res.json({ code: 200, message: 'success', data: updated });
  });

  // Create round
  router.post('/tournaments/:id/rounds', authMiddleware, roleMiddleware('ADMIN'), validate(createRoundSchema), async (req, res) => {
    const { name, roundType, durationSeconds } = req.body;
    const existingCount = await repos.rounds.countByTournament(req.params.id);
    if (existingCount >= 3) {
      return res.json({ code: 40010, message: '轮次数量已达上限(3个)', data: null });
    }
    const roundNumber = existingCount + 1;
    const r = await repos.rounds.create({ tournamentId: req.params.id, roundNumber, name, roundType, durationSeconds });
    res.json({ code: 200, message: 'success', data: r });
  });

  // List rounds
  router.get('/tournaments/:id/rounds', authMiddleware, async (req, res) => {
    const rounds = await repos.rounds.findWithPuzzles(req.params.id);
    res.json({ code: 200, message: 'success', data: rounds });
  });

  // Import puzzles
  router.post('/rounds/:roundId/puzzles/import', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
    const { puzzles } = req.body;
    if (!puzzles || !Array.isArray(puzzles)) {
      return res.json({ code: 40020, message: '题目数据格式错误', data: null });
    }
    const round = await repos.rounds.findById(req.params.roundId);
    if (!round) return res.json({ code: 40400, message: '轮次不存在', data: null });

    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (let i = 0; i < puzzles.length; i++) {
      const p = puzzles[i];
      try {
        if (!p.initialGrid || !p.solution) throw new Error('缺少棋盘数据');
        await repos.puzzles.create({
          roundId: parseInt(req.params.roundId),
          puzzleType: p.type || 'STANDARD',
          orderInRound: p.order || (i + 1),
          initialGrid: JSON.stringify(p.initialGrid),
          solution: JSON.stringify(p.solution),
          points: p.points || 100,
          letter: p.letter || null
        });
        successCount++;
      } catch (e) {
        failCount++;
        errors.push({ index: i, message: e.message });
      }
    }
    res.json({ code: 200, message: 'success', data: { successCount, failCount, errors } });
  });

  // List puzzles
  router.get('/rounds/:roundId/puzzles', authMiddleware, async (req, res) => {
    const puzzles = await repos.puzzles.findByRoundSummary(req.params.roundId);
    res.json({ code: 200, message: 'success', data: puzzles });
  });

  // Create team
  router.post('/tournaments/:id/teams', authMiddleware, roleMiddleware('ADMIN'), validate(createTeamSchema), async (req, res) => {
    const { name } = req.body;
    const t = await repos.teams.create({ tournamentId: parseInt(req.params.id), name });
    res.json({ code: 200, message: 'success', data: t });
  });

  // List teams
  router.get('/tournaments/:id/teams', authMiddleware, async (req, res) => {
    const teams = await repos.teams.findByTournamentWithMembers(req.params.id);
    res.json({ code: 200, message: 'success', data: teams });
  });

  // Add team member
  router.post('/teams/:teamId/members', authMiddleware, roleMiddleware('ADMIN'), validate(addTeamMemberSchema), async (req, res) => {
    const { playerId, position } = req.body;
    if (await repos.teams.memberExists(req.params.teamId, playerId)) {
      return res.json({ code: 40030, message: '选手已在该队伍中', data: null });
    }
    const team = await repos.teams.findById(req.params.teamId);
    if (await repos.teams.playerInOtherTeam(team.tournament_id, playerId)) {
      return res.json({ code: 40030, message: '选手已分配到其他队伍', data: null });
    }
    await repos.teams.addMember({ teamId: parseInt(req.params.teamId), playerId, position });
    res.json({ code: 200, message: 'success', data: { teamId: req.params.teamId, playerId, position } });
  });

  // Assign judge
  router.post('/tournaments/:id/judges', authMiddleware, roleMiddleware('ADMIN'), validate(assignJudgeSchema), async (req, res) => {
    const { judgeId } = req.body;
    if (await repos.teams.judgeAlreadyAssigned(req.params.id, judgeId)) {
      return res.json({ code: 40010, message: '裁判已分配', data: null });
    }
    await repos.teams.assignJudge({ tournamentId: parseInt(req.params.id), judgeId });
    res.json({ code: 200, message: 'success', data: { tournamentId: req.params.id, judgeId } });
  });

  return router;
}

module.exports = { createTournamentRouter };
