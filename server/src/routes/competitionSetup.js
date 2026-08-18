const express = require('express');
const { authMiddleware, roleMiddleware, ADMIN_ROLES } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { validateBody } = require('../middleware/validate');
const {
  createRoundSchema,
  createTeamSchema,
  addTeamMemberSchema,
  assignJudgeSchema,
} = require('../validations/competitions');
const {
  TeamRoundType,
  IndividualRoundType,
  PKRoundType,
  getStageCategoryForRoundType,
} = require('../engine/RoundTypes');

// Which round types belong to which stage category. Derived from the engine's
// own definitions so the two cannot drift apart.
const ROUND_TYPES_BY_STAGE = {
  TEAM: Object.values(TeamRoundType),
  INDIVIDUAL: Object.values(IndividualRoundType),
  PK: Object.values(PKRoundType),
};

// Routes for setting up a competition: its rounds, puzzles, teams, and judges.
// The CRUD competition routes (create/list/detail/update/delete) live in
// routes/competitions.js.
//
// repos.rounds.create(), repos.teams.create() and repos.teams.assignJudge()
// take `competitionId` — the competition UUID from req.params.id.
function createCompetitionSetupRouter(repos) {
  const router = express.Router();

  // Round types allowed in each kind of stage. Served rather than duplicated
  // in the client, so the dropdown and the server validation always agree.
  router.get('/round-types', authMiddleware, async (req, res) => {
    res.json({ code: 200, message: 'success', data: ROUND_TYPES_BY_STAGE });
  });

  // Create a round INSIDE a stage.
  //
  // Rounds belong to a stage, not to a competition: a competition is a
  // sequence of stages, each with its own rounds. The older
  // POST /competitions/:id/rounds carried no stage, so every round landed in
  // whichever stage happened to be first — and it capped the whole
  // competition at 3 rounds, which makes no sense once several stages exist.
  //
  // No cap here: the number of rounds per stage is deliberately open for now.
  router.post(
    '/competitions/:id/stages/:stageId/rounds',
    authMiddleware,
    tenantGuard('competitions'),
    roleMiddleware(...ADMIN_ROLES),
    validateBody(createRoundSchema),
    async (req, res) => {
      const { name, roundType, durationSeconds, preparationSeconds } = req.body;
      const { id: competitionId, stageId } = req.params;

      const stage = await repos.rounds.findStageById(stageId);
      if (!stage) return res.json({ code: 40400, message: '阶段不存在', data: null });
      // tenantGuard checked the competition; make sure the stage is one of ITS
      // stages, so an admin cannot reach into another competition of the org.
      if (stage.competition_id !== competitionId) {
        return res.json({ code: 40400, message: '阶段不属于该赛事', data: null });
      }

      // A team round in an individual stage would be accepted by the schema
      // (the type exists) but broken at run time: the engine picks its round
      // engine from the type, and rankings are computed per stage category.
      const category = getStageCategoryForRoundType(roundType);
      if (category !== stage.type) {
        return res.json({ code: 40011, message: '轮次类型与阶段类型不匹配', data: null });
      }

      const round = await repos.rounds.create({ stageId, name, roundType, durationSeconds, preparationSeconds });
      res.json({ code: 200, message: 'success', data: round });
    }
  );

  // List rounds — :id is a competition.
  router.get('/competitions/:id/rounds', authMiddleware, tenantGuard('competitions'), async (req, res) => {
    const rounds = await repos.rounds.findWithPuzzles(req.params.id);
    res.json({ code: 200, message: 'success', data: rounds });
  });

  // Import puzzles — :roundId is a round. The ownership chain is
  // rounds → competition_stages → competitions → organization_id (two hops),
  // which tenantGuard's single-hop `via` cannot express. We fall back to
  // tenantGuard() (org-membership only). See JOURNAL_MODIFICATIONS for debt.
  router.post('/rounds/:roundId/puzzles/import', authMiddleware, tenantGuard(), roleMiddleware(...ADMIN_ROLES), async (req, res) => {
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
          roundId: req.params.roundId,
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

  // List puzzles — :roundId is a round. Same two-hop chain debt as above.
  router.get('/rounds/:roundId/puzzles', authMiddleware, tenantGuard(), async (req, res) => {
    const puzzles = await repos.puzzles.findByRoundSummary(req.params.roundId);
    res.json({ code: 200, message: 'success', data: puzzles });
  });

  // Create team — :id is a competition.
  router.post('/competitions/:id/teams', authMiddleware, tenantGuard('competitions'), roleMiddleware(...ADMIN_ROLES), validateBody(createTeamSchema), async (req, res) => {
    const { name } = req.body;
    const competitionId = req.params.id;
    const team = await repos.teams.create({ competitionId, name });
    res.json({ code: 200, message: 'success', data: team });
  });

  // List teams — :id is a competition.
  router.get('/competitions/:id/teams', authMiddleware, tenantGuard('competitions'), async (req, res) => {
    const teams = await repos.teams.findByCompetitionWithMembers(req.params.id);
    res.json({ code: 200, message: 'success', data: teams });
  });

  // Add team member — :teamId is a team. The ownership chain is
  // teams → competitions → organization_id, but tenantGuard's `via` joins on a
  // column of the same name in both tables, and here the FK is
  // teams.competition_id while the PK is competitions.id. We fall back to
  // tenantGuard() (org-membership only). See JOURNAL_MODIFICATIONS for debt.
  router.post('/teams/:teamId/members', authMiddleware, tenantGuard(), roleMiddleware(...ADMIN_ROLES), validateBody(addTeamMemberSchema), async (req, res) => {
    const { playerId, position } = req.body;
    if (await repos.teams.memberExists(req.params.teamId, playerId)) {
      return res.json({ code: 40030, message: '选手已在该队伍中', data: null });
    }
    const team = await repos.teams.findById(req.params.teamId);
    // findById returns the raw `teams` row, whose FK column is
    // `competition_id`. It was read as `team.tournament_id` here — a column
    // that has not existed since the UUID migration — so this guard passed
    // `undefined` and never actually detected a player already placed in
    // another team of the same competition.
    if (await repos.teams.playerInOtherTeam(team.competition_id, playerId)) {
      return res.json({ code: 40030, message: '选手已分配到其他队伍', data: null });
    }
    await repos.teams.addMember({ teamId: req.params.teamId, playerId, position });
    res.json({ code: 200, message: 'success', data: { teamId: req.params.teamId, playerId, position } });
  });

  // Assign judge — :id is a competition.
  router.post('/competitions/:id/judges', authMiddleware, tenantGuard('competitions'), roleMiddleware(...ADMIN_ROLES), validateBody(assignJudgeSchema), async (req, res) => {
    const { judgeId } = req.body;
    const competitionId = req.params.id;
    if (await repos.teams.judgeAlreadyAssigned(competitionId, judgeId)) {
      return res.json({ code: 40010, message: '裁判已分配', data: null });
    }
    await repos.teams.assignJudge({ competitionId, judgeId });
    res.json({ code: 200, message: 'success', data: { competitionId, judgeId } });
  });

  return router;
}

module.exports = { createCompetitionSetupRouter };
