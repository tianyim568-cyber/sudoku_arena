const express = require('express');
const bcrypt = require('bcryptjs');
const { authMiddleware, roleMiddleware, ADMIN_ROLES } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { validateBody } = require('../middleware/validate');
const {
  createRoundSchema,
  updateRoundSchema,
  createTeamSchema,
  addTeamMemberSchema,
  assignJudgeSchema,
  createAndAssignJudgeSchema,
} = require('../validations/competitions');
const { generateUsername, generatePassword } = require('../utils/credentials');
const logger = require('../utils/logger');
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
//
// `prisma` is optional — when omitted, the real Prisma client is used via
// getPrisma(). Tests pass a mock to avoid hitting the database.
function createCompetitionSetupRouter(repos, prisma) {
  if (!prisma) {
    const { getPrisma } = require('../db/prisma');
    prisma = getPrisma();
  }
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

  // Delete a round INSIDE a stage.
  //
  // Ownership chain: competition → stage → round. tenantGuard covers the
  // competition hop; the stage-exists-and-belongs-to-competition check covers
  // the second; findByIdAndStage covers the third. No cross-org leak.
  //
  // Safety guard: a round that has already started (status !== 'WAITING')
  // cannot be deleted. player_round_sessions has onDelete: NoAction, so a
  // running round would leave dangling sessions and corrupt rankings. The
  // caller must wait for the round to finish, or clear the competition.
  router.delete(
    '/competitions/:id/stages/:stageId/rounds/:roundId',
    authMiddleware,
    tenantGuard('competitions'),
    roleMiddleware(...ADMIN_ROLES),
    async (req, res) => {
      const { id: competitionId, stageId, roundId } = req.params;
      try {
        const stage = await repos.rounds.findStageById(stageId);
        if (!stage || stage.competition_id !== competitionId) {
          return res.json({ code: 40400, message: '阶段不属于该赛事', data: null });
        }

        const round = await repos.rounds.findByIdAndStage(roundId, stageId);
        if (!round) {
          return res.json({ code: 40400, message: '轮次不存在', data: null });
        }

        if (round.status && round.status !== 'WAITING') {
          return res.json({ code: 40030, message: '已启动的轮次无法删除', data: null });
        }

        await repos.rounds.delete(roundId);
        logger.info(`Round ${roundId} deleted by user ${req.user.id} (org ${req.user.organizationId})`);
        res.json({ code: 200, message: 'success', data: { id: roundId } });
      } catch (err) {
        logger.error({ err, roundId, stageId, competitionId }, 'Failed to delete round');
        res.json({ code: 50001, message: '删除轮次失败', data: null });
      }
    }
  );

  // Update a round's editable fields (name, duration, preparation).
  //
  // Partial update — only the keys present in the body are written. The
  // round's type is NOT editable: changing it after puzzles are imported
  // would break the engine (rankings are per stage category, and puzzles
  // were picked for the original type). The Zod schema enforces this by
  // simply not having a `roundType` field.
  //
  // Same status guard as delete: a started round is immutable.
  router.put(
    '/competitions/:id/stages/:stageId/rounds/:roundId',
    authMiddleware,
    tenantGuard('competitions'),
    roleMiddleware(...ADMIN_ROLES),
    validateBody(updateRoundSchema),
    async (req, res) => {
      const { id: competitionId, stageId, roundId } = req.params;
      try {
        const stage = await repos.rounds.findStageById(stageId);
        if (!stage || stage.competition_id !== competitionId) {
          return res.json({ code: 40400, message: '阶段不属于该赛事', data: null });
        }

        const round = await repos.rounds.findByIdAndStage(roundId, stageId);
        if (!round) {
          return res.json({ code: 40400, message: '轮次不存在', data: null });
        }

        if (round.status && round.status !== 'WAITING') {
          return res.json({ code: 40030, message: '已启动的轮次无法修改', data: null });
        }

        const updated = await repos.rounds.update(roundId, req.body);
        logger.info(`Round ${roundId} updated by user ${req.user.id} (org ${req.user.organizationId})`);
        res.json({ code: 200, message: 'success', data: updated });
      } catch (err) {
        logger.error({ err, roundId, stageId, competitionId }, 'Failed to update round');
        res.json({ code: 50001, message: '修改轮次失败', data: null });
      }
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
  // tenantGuard() (org-membership only) and add manual two-hop validation.
  router.post('/rounds/:roundId/puzzles/import', authMiddleware, tenantGuard(), roleMiddleware(...ADMIN_ROLES), async (req, res) => {
    const { puzzles } = req.body;
    if (!puzzles || !Array.isArray(puzzles)) {
      return res.json({ code: 40020, message: '题目数据格式错误', data: null });
    }
    const round = await repos.rounds.findById(req.params.roundId);
    if (!round) return res.json({ code: 40400, message: '轮次不存在', data: null });

    // SECURITY: Two-hop validation — verify round belongs to user's organization
    const stage = await prisma.competition_stages.findFirst({
      where: {
        id: round.stage_id,
        competitions: { organization_id: req.user.organizationId },
      },
    });
    if (!stage) {
      return res.json({ code: 40301, message: '无权访问此轮次', data: null });
    }

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
        errors.push({ index: i, message: e.message || '导入失败' });
      }
    }
    res.json({ code: 200, message: 'success', data: { successCount, failCount, errors } });
  });

  // List puzzles — :roundId is a round. Same two-hop chain as above.
  router.get('/rounds/:roundId/puzzles', authMiddleware, tenantGuard(), async (req, res) => {
    const round = await repos.rounds.findById(req.params.roundId);
    if (!round) return res.json({ code: 40400, message: '轮次不存在', data: null });

    // SECURITY: Two-hop validation — verify round belongs to user's organization
    const stage = await prisma.competition_stages.findFirst({
      where: {
        id: round.stage_id,
        competitions: { organization_id: req.user.organizationId },
      },
    });
    if (!stage) {
      return res.json({ code: 40301, message: '无权访问此轮次', data: null });
    }

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
  // teams → competitions → organization_id. We add manual validation
  // to verify the team's competition belongs to the user's organization.
  router.post('/teams/:teamId/members', authMiddleware, tenantGuard(), roleMiddleware(...ADMIN_ROLES), validateBody(addTeamMemberSchema), async (req, res) => {
    const { playerId, position } = req.body;
    if (await repos.teams.memberExists(req.params.teamId, playerId)) {
      return res.json({ code: 40030, message: '选手已在该队伍中', data: null });
    }
    const team = await repos.teams.findById(req.params.teamId);
    if (!team) return res.json({ code: 40400, message: '队伍不存在', data: null });

    // SECURITY: Verify team's competition belongs to user's organization
    const competition = await prisma.competitions.findFirst({
      where: { id: team.competition_id, organization_id: req.user.organizationId },
    });
    if (!competition) {
      return res.json({ code: 40301, message: '无权访问此队伍', data: null });
    }

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

  // Remove team member — :teamId is a team, :participantId is a participant.
  // Same ownership chain as add member.
  router.delete('/teams/:teamId/members/:participantId', authMiddleware, tenantGuard(), roleMiddleware(...ADMIN_ROLES), async (req, res) => {
    const { teamId, participantId } = req.params;
    const team = await repos.teams.findById(teamId);
    if (!team) return res.json({ code: 40400, message: '队伍不存在', data: null });

    // SECURITY: Verify team's competition belongs to user's organization
    const competition = await prisma.competitions.findFirst({
      where: { id: team.competition_id, organization_id: req.user.organizationId },
    });
    if (!competition) {
      return res.json({ code: 40301, message: '无权访问此队伍', data: null });
    }

    if (!(await repos.teams.memberExists(teamId, participantId))) {
      return res.json({ code: 40400, message: '选手不在该队伍中', data: null });
    }

    await repos.teams.removeMember(teamId, participantId);
    res.json({ code: 200, message: 'success', data: null });
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

  // Create a new judge user from a display name and assign them to the
  // competition in one step. The system generates a unique username and a
  // random password, hashes it, and atomically creates the user row + the
  // competition_judges junction row. Retries up to 3 times on username
  // collision (P2002) — the random suffix makes this vanishingly unlikely,
  // but the loop is cheap insurance.
  router.post(
    '/competitions/:id/judges/create-and-assign',
    authMiddleware,
    tenantGuard('competitions'),
    roleMiddleware(...ADMIN_ROLES),
    validateBody(createAndAssignJudgeSchema),
    async (req, res) => {
      const { displayName } = req.body;
      const competitionId = req.params.id;
      const organizationId = req.user.organizationId;

      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const username = generateUsername(displayName);
        const password = generatePassword(10);
        const passwordHash = bcrypt.hashSync(password, 10);

        try {
          const result = await prisma.$transaction(async (tx) => {
            // Create the user with role JUDGE, scoped to the caller's org.
            const newUser = await tx.users.create({
              data: {
                username,
                password_hash: passwordHash,
                role: 'JUDGE',
                organization_id: organizationId,
              },
            });

            // Assign the new judge to the competition.
            await tx.competition_judges.create({
              data: {
                competition_id: competitionId,
                user_id: newUser.id,
              },
            });

            return newUser;
          });

          // Success — return the plaintext password so the admin can share it
          // once. It is never stored or logged server-side beyond this response.
          return res.json({
            code: 200,
            message: 'success',
            data: {
              userId: result.id,
              username,
              password,
              displayName,
            },
          });
        } catch (err) {
          // P2002 = unique constraint violation on username. Another admin
          // created a judge with the same slug at the same moment. Retry with
          // a fresh random suffix.
          if (err.code === 'P2002' && attempt < MAX_RETRIES - 1) {
            continue;
          }
          // Anything else (or retries exhausted) — report the failure.
          return res.json({
            code: 40010,
            message: err.message || 'Failed to create judge',
            data: null,
          });
        }
      }

      // Exhausted retries (should not reach here, but guard anyway).
      res.json({ code: 40010, message: 'Failed to generate unique username', data: null });
    }
  );

  return router;
}

module.exports = { createCompetitionSetupRouter };
