/**
 * competitions routes — CRUD + access link generation and management.
 *
 * CRUD endpoints (create/list/detail/update/delete) were moved here from
 * routes/competitions.js in Phase 4 of the tournament→competition migration.
 * They live at the root of this router (mounted on /api/competitions), so
 * their paths are '/' and '/:id'.
 *
 * Access-link endpoints let an ORG_ADMIN generate, retrieve, and revoke
 * competition entry links. Each link contains a unique 8-character access
 * code that resolves to a specific competition.
 *
 * Public endpoint allows anyone with the link to view basic competition info
 * (name, status) before logging in.
 *
 * Auth: CRUD + generate/retrieve/revoke require org-scoped JWT + ADMIN_ROLES.
 *       The info endpoint is public (no auth).
 *
 * Route mounting:
 *   app.use('/api/competitions', createCompetitionRouter(repos));
 *
 * Declaration order does not matter here: /by-code/... routes have a
 * different number of path segments than /:id, so Express cannot confuse
 * 'by-code' with a value of :id regardless of order.
 */

const express = require('express');
const crypto = require('crypto');
const { authMiddleware, roleMiddleware, ADMIN_ROLES } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { validateBody } = require('../middleware/validate');
const {
  createCompetitionSchema,
  updateCompetitionSchema,
} = require('../validations/competitions');
const { getPrisma } = require('../db/prisma');
const { competitionLogin } = require('../middleware/competitionAuth');
const { evaluatePublishability } = require('../services/PublishabilityService');
const config = require('../config');
const logger = require('../utils/logger');

// Stable, localisable messages for each unmet publishability criterion.
// The client receives the machine code and maps it to a translated string;
// the server still returns a readable Chinese fallback for callers that do
// not localise (e.g. curl, E2E scripts).
const MISSING_LABELS = {
  NO_JUDGE: '尚未分配裁判',
  NO_PARTICIPANT: '尚未添加参赛者',
  NO_STAGE: '尚未创建任何阶段',
  STAGE_EMPTY: '存在没有轮次的阶段',
  ROUND_EMPTY: '存在没有题目的轮次',
};

/**
 * Generate a URL-safe, 8-character alphanumeric access code.
 * Uses crypto.randomBytes for cryptographic randomness.
 * @returns {string} e.g. "a3f9b2c1"
 */
function generateAccessCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Build the full entry URL from an access code.
 * @param {string} accessCode
 * @returns {string} e.g. "http://localhost:5173/competition/a3f9b2c1"
 */
function buildEntryUrl(accessCode) {
  return `${config.CLIENT_URL}/competition/${accessCode}`;
}

function createCompetitionRouter(repos, displayManager) {
  const router = express.Router();

  // ── CRUD endpoints (moved from routes/competitions.js in Phase 4) ──
  // /by-code/... routes below have a different number of path segments than
  // /:id, so Express cannot confuse 'by-code' with a value of :id —
  // declaration order does not matter here.

  /**
   * POST / — Create a competition.
   *
   * tenantGuard() (no resource) asserts the caller belongs to an org and
   * sets req.organizationId. For SUPER_ADMIN without a target org, the guard
   * passes but req.organizationId is null → the column is NOT NULL → we
   * surface a clear 40001 instead of an opaque Prisma error.
   *
   * Auth: Bearer token (org-scoped) + ADMIN_ROLES
   */
  router.post(
    '/',
    authMiddleware,
    tenantGuard(),
    roleMiddleware(...ADMIN_ROLES),
    validateBody(createCompetitionSchema),
    async (req, res) => {
      if (!req.organizationId) {
        return res.json({ code: 40001, message: '缺少组织标识', data: null });
      }
      const { name, description, scheduledTime } = req.body;
      const t = await repos.competitions.create({
        name,
        description: description || '',
        scheduledTime,
        createdBy: req.user.userId,
        organizationId: req.organizationId,
      });
      res.json({ code: 200, message: 'success', data: t });
    }
  );

  /**
   * GET / — List competitions, scoped to the caller's org.
   * SUPER_ADMIN (no org) sees all competitions.
   *
   * Auth: Bearer token (org-scoped)
   */
  router.get(
    '/',
    authMiddleware,
    tenantGuard(),
    async (req, res) => {
      const ts = await repos.competitions.findAll(req.organizationId);
      res.json({ code: 200, message: 'success', data: ts });
    }
  );

  /**
   * GET /:id — Competition detail (rounds, teams, judges).
   * tenantGuard('competitions') verifies the :id belongs to the caller's org.
   *
   * Auth: Bearer token (org-scoped)
   */
  router.get(
    '/:id',
    authMiddleware,
    tenantGuard('competitions'),
    async (req, res) => {
      const t = await repos.competitions.findById(req.params.id);
      if (!t) return res.json({ code: 40400, message: '比赛不存在', data: null });
      const rounds = await repos.rounds.findWithPuzzles(req.params.id);
      const teams = await repos.teams.findByCompetitionWithMemberCount(req.params.id);
      for (const tm of teams) {
        tm.members = await repos.teams.getMembers(tm.id);
      }
      const judges = await repos.teams.getJudges(req.params.id);
      res.json({ code: 200, message: 'success', data: { ...t, rounds, teams, judges } });
    }
  );

  /**
   * GET /:id/results — Historical results for the admin dashboard.
   *
   * Returns the same ranking snapshot the big-screen display uses, but behind
   * org-scoped admin auth instead of a display token. The admin can review
   * every round's ranking and the final rankings from the dashboard without
   * having to generate (and revoke) a display token just to look.
   *
   * Reuses DisplayManager.getRankingSnapshot so the admin and the big screen
   * always see the same numbers — two code paths producing rankings would
   * drift apart.
   *
   * Auth: Bearer token (org-scoped) + ADMIN_ROLES
   * Tenant: competition must belong to caller's organization
   *
   * Response:
   *   200 { code: 200, data: { competition, stages[], finalRankings[], categories[] } }
   *   404 { code: 40400 } — competition not found
   *   500 { code: 50000 } — snapshot failed
   */
  router.get(
    '/:id/results',
    authMiddleware,
    tenantGuard('competitions'),
    roleMiddleware(...ADMIN_ROLES),
    async (req, res) => {
      const { id } = req.params;
      if (!displayManager) {
        return res.json({ code: 50000, message: '结果快照不可用', data: null });
      }
      try {
        const snapshot = await displayManager.getRankingSnapshot(id);
        res.json({ code: 200, message: 'success', data: snapshot });
      } catch (e) {
        if (e.message === 'Competition not found') {
          return res.json({ code: 40400, message: '比赛不存在', data: null });
        }
        logger.error('Get competition results failed', { competitionId: id, error: e.message });
        res.json({ code: 50000, message: '获取结果失败', data: null });
      }
    }
  );

  /**
   * PUT /:id — Update a competition (only while PENDING/DRAFT).
   * tenantGuard('competitions') verifies ownership.
   *
   * Auth: Bearer token (org-scoped) + ADMIN_ROLES
   */
  router.put(
    '/:id',
    authMiddleware,
    tenantGuard('competitions'),
    roleMiddleware(...ADMIN_ROLES),
    validateBody(updateCompetitionSchema),
    async (req, res) => {
      const t = await repos.competitions.findById(req.params.id);
      if (!t) return res.json({ code: 40400, message: '比赛不存在', data: null });
      // Editable while being prepared, frozen once it has started. The guard
      // used to require status === 'PENDING', a value from the pre-UUID schema
      // that the server never writes: every competition is created DRAFT, so
      // renaming one always failed with "already started".
      if (t.status !== 'DRAFT' && t.status !== 'PUBLISHED') {
        return res.json({ code: 40041, message: '比赛已开始，无法修改', data: null });
      }
      const { name, description, scheduledTime } = req.body;
      const updated = await repos.competitions.update(req.params.id, { name, description, scheduledTime });
      res.json({ code: 200, message: 'success', data: updated });
    }
  );

  /**
   * DELETE /:id — Delete a competition unless it is currently running.
   * tenantGuard('competitions') verifies ownership.
   *
   * The guard used to test for IN_PROGRESS / PAUSED — statuses from the
   * pre-UUID schema that the server never writes any more. A live competition
   * (status RUNNING, players connected) therefore passed straight through and
   * could be deleted mid-game.
   *
   * Auth: Bearer token (org-scoped) + ADMIN_ROLES
   */
  router.delete(
    '/:id',
    authMiddleware,
    tenantGuard('competitions'),
    roleMiddleware(...ADMIN_ROLES),
    async (req, res) => {
      const competition = await repos.competitions.findById(req.params.id);
      if (!competition) return res.json({ code: 40400, message: '比赛不存在', data: null });
      if (competition.status === 'RUNNING') {
        return res.json({ code: 40041, message: '比赛进行中，无法删除，请先结束比赛', data: null });
      }
      await repos.competitions.deleteCascade(req.params.id);
      res.json({ code: 200, message: 'success', data: { deleted: req.params.id } });
    }
  );

  // ── Protected endpoints (org-scoped auth + ORG_ADMIN) ──

  /**
   * Build the publishability snapshot from the database.
   *
   * Used by both POST /:id/publish (the route re-verifies server-side, the
   * client cannot be trusted) and GET /:id/publishability (the panel reads
   * it to decide whether to enable the Publish button). Both must see the
   * same data — centralising the fetch here keeps them in sync.
   *
   * @param {string} competitionId
   * @returns {Promise<object>} snapshot in the shape evaluatePublishability expects.
   */
  async function fetchPublishabilitySnapshot(competitionId) {
    const prisma = getPrisma();

    // Judges — only need to know if there is at least one.
    const judges = await prisma.competition_judges.findMany({
      where: { competition_id: competitionId },
      select: { user_id: true },
    });

    // Participants — only need to know if there is at least one.
    const participants = await prisma.players.findMany({
      where: { competition_id: competitionId },
      select: { id: true },
    });

    // Stages with their rounds and the COUNT of puzzles per round. We do
    // not need the puzzle bodies, only whether each round has any — a count
    // keeps the payload small for competitions with many puzzles.
    const stages = await prisma.competition_stages.findMany({
      where: { competition_id: competitionId },
      orderBy: { order_number: 'asc' },
      select: {
        id: true,
        type: true,
        order_number: true,
        rounds: {
          orderBy: { order_number: 'asc' },
          select: {
            id: true,
            _count: { select: { round_puzzles: true } },
          },
        },
      },
    });

    // Reshape to match evaluatePublishability's contract: each round needs
    // a `puzzles` array whose length matters, not the _count object.
    return {
      judges,
      participants,
      stages: stages.map((s) => ({
        id: s.id,
        type: s.type,
        order_number: s.order_number,
        rounds: s.rounds.map((r) => ({
          id: r.id,
          puzzles: Array(r._count.round_puzzles).fill(null),
        })),
      })),
    };
  }

  /**
   * POST /:id/publish — Mark a competition as ready to start.
   *
   * The route re-runs the publishability check from the real database state.
   * The client shows the same check in the panel, but a client can lie (or
   * simply be one refresh behind); the server is the source of truth.
   *
   * If the check fails, the response lists every missing criterion as
   * machine-readable codes plus a readable Chinese summary, so the admin
   * knows exactly what to fix. "Impossible to publish" alone is useless.
   *
   * Publishing is also the moment the access link is generated — Louise's
   * decision: the link that participants and judges receive is what makes
   * the competition visible from the outside, and that happens here, not
   * at creation. If a link already exists (e.g. the competition was
   * cancelled and is being re-published), it is replaced: the old URL
   * stops working.
   *
   * Auth: Bearer token (org-scoped) + ADMIN_ROLES
   * Tenant: competition must belong to caller's organization
   *
   * Response:
   *   200 { code: 200, data: { id, status: 'PUBLISHED' } }
   *   400 { code: 40010, message, data: { missing: [...] } } — not publishable
   *   400 { code: 40041 } — competition is RUNNING or FINISHED, cannot publish
   *   404 { code: 40400 } — competition not found
   */
  router.post(
    '/:id/publish',
    authMiddleware,
    roleMiddleware('ORG_ADMIN', 'SUPER_ADMIN'),
    tenantGuard('competitions'),
    async (req, res) => {
      const { id } = req.params;
      const prisma = getPrisma();

      try {
        const competition = await prisma.competitions.findUnique({ where: { id } });
        if (!competition) {
          return res.json({ code: 40400, message: '比赛不存在', data: null });
        }

        // A RUNNING or FINISHED competition cannot be (re)published. The
        // status is forward-only once the game has started.
        if (competition.status === 'RUNNING' || competition.status === 'FINISHED') {
          return res.json({ code: 40041, message: '比赛已开始或已结束，无法发布', data: null });
        }

        // Re-verify from real state. The client may have toggled the button
        // based on a stale snapshot.
        const snapshot = await fetchPublishabilitySnapshot(id);
        const { publishable, missing } = evaluatePublishability(snapshot);
        if (!publishable) {
          const summary = missing.map((c) => MISSING_LABELS[c] || c).join('；');
          return res.json({
            code: 40010,
            message: `无法发布：${summary}`,
            data: { missing },
          });
        }

        // Publishing does NOT create the access link — it UNLOCKS creating
        // one. Louise's rule: "publier doit activer le bouton générer; tant
        // qu'une compétition n'est pas publiée on ne peut pas générer le lien."
        // Keeping the two apart leaves the admin in charge of when the URL
        // starts existing, and leaves exactly one way to mint it
        // (POST /:id/access-link, which refuses while the status is DRAFT).
        // Two code paths producing the same link would drift apart.
        await prisma.competitions.update({
          where: { id },
          data: { status: 'PUBLISHED' },
        });

        res.json({
          code: 200,
          message: 'success',
          data: { id, status: 'PUBLISHED' },
        });
      } catch (e) {
        logger.error('Publish competition failed', { competitionId: id, error: e.message });
        res.json({ code: 50000, message: '发布失败', data: null });
      }
    }
  );

  /**
   * POST /:id/cancel — Cancel a publication.
   *
   * Louise's decision: "on ne dépublie pas. Mais on peut annuler."
   * Cancelling is a DESTRUCTIVE action with consequences outside the system:
   *   - the access link is destroyed (the column is cleared)
   *   - anyone who already received the URL can no longer enter
   *   - the competition becomes modifiable again (status → DRAFT)
   *
   * This is NOT a toggle. The admin interface must warn before calling this
   * route — a stray click must not revoke a link that was already sent to a
   * hundred participants. The route itself does not re-confirm; that is the
   * client's responsibility.
   *
   * Allowed only while the competition has not started. Once RUNNING, the
   * status is forward-only — the admin must end the competition instead.
   *
   * Auth: Bearer token (org-scoped) + ADMIN_ROLES
   * Tenant: competition must belong to caller's organization
   *
   * Response:
   *   200 { code: 200, data: { id, status: 'DRAFT' } }
   *   400 { code: 40041 } — competition is RUNNING or FINISHED
   *   404 { code: 40400 } — competition not found
   */
  router.post(
    '/:id/cancel',
    authMiddleware,
    roleMiddleware('ORG_ADMIN', 'SUPER_ADMIN'),
    tenantGuard('competitions'),
    async (req, res) => {
      const { id } = req.params;
      const prisma = getPrisma();

      try {
        const competition = await prisma.competitions.findUnique({ where: { id } });
        if (!competition) {
          return res.json({ code: 40400, message: '比赛不存在', data: null });
        }
        if (competition.status === 'RUNNING' || competition.status === 'FINISHED') {
          return res.json({ code: 40041, message: '比赛已开始或已结束，无法取消发布', data: null });
        }
        // Destroy the access link and revert to DRAFT. The competition
        // becomes modifiable again. We clear competition_access_code rather
        // than leaving it: GET /:id/access-link will return null, and the
        // client AccessLinkSection will show the "Generate" state (which
        // is also what a brand-new competition shows — that is fine, the
        // admin knows they just cancelled).
        await prisma.competitions.update({
          where: { id },
          data: {
            status: 'DRAFT',
            competition_access_code: null,
          },
        });
        res.json({
          code: 200,
          message: 'success',
          data: { id, status: 'DRAFT' },
        });
      } catch (e) {
        logger.error('Cancel competition failed', { competitionId: id, error: e.message });
        res.json({ code: 50000, message: '取消发布失败', data: null });
      }
    }
  );

  /**
   * GET /:id/publishability — Compute whether the competition is publishable.
   *
   * The panel on the detail page reads this to decide whether to enable the
   * Publish (and Start) buttons. The route re-uses the same snapshot+rule as
   * POST /:id/publish, so what the panel shows is what the route will enforce.
   *
   * The response also returns the current status, so the panel can render
   * the right badge without a second round-trip to GET /:id.
   *
   * Auth: Bearer token (org-scoped) + ADMIN_ROLES — same gate as the publish
   * action itself. A judge or player has no business asking "is this
   * publishable" and should not learn about the internal readiness state.
   *
   * Response:
   *   200 { code: 200, data: { status, publishable, missing: [...] } }
   *   404 { code: 40400 } — competition not found
   */
  router.get(
    '/:id/publishability',
    authMiddleware,
    roleMiddleware('ORG_ADMIN', 'SUPER_ADMIN'),
    tenantGuard('competitions'),
    async (req, res) => {
      const { id } = req.params;
      const prisma = getPrisma();

      try {
        const competition = await prisma.competitions.findUnique({
          where: { id },
          select: { id: true, status: true },
        });
        if (!competition) {
          return res.json({ code: 40400, message: '比赛不存在', data: null });
        }
        const snapshot = await fetchPublishabilitySnapshot(id);
        const { publishable, missing } = evaluatePublishability(snapshot);
        res.json({
          code: 200,
          message: 'success',
          data: { status: competition.status, publishable, missing },
        });
      } catch (e) {
        logger.error('Get publishability failed', { competitionId: id, error: e.message });
        res.json({ code: 50000, message: '获取发布状态失败', data: null });
      }
    }
  );

  /**
   * POST /:id/access-link — Generate a new access link for a competition.
   *
   * If the competition already has an access code, it is replaced with a new one.
   * Returns the access code and the full entry URL.
   *
   * Requires the competition to be PUBLISHED. Publishing does not create the
   * link itself — it unlocks the ability to create one. A DRAFT competition
   * has, by definition, an unfinished configuration; handing out an entry URL
   * for it would invite people into something that is still being built.
   *
   * Cancelling a publication clears the code and reverts to DRAFT, which
   * re-locks this route on its own — the status is the single gate.
   *
   * Auth: Bearer token (org-scoped) + ORG_ADMIN role
   * Tenant: competition must belong to caller's organization
   *
   * Response:
   *   200 { code: 200, data: { accessCode, entryUrl } }
   *   400 { code: 40041 } — competition is not published
   *   404 { code: 40400 } — competition not found
   */
  router.post(
    '/:id/access-link',
    authMiddleware,
    roleMiddleware('ORG_ADMIN', 'SUPER_ADMIN'),
    tenantGuard('competitions'),
    async (req, res) => {
      const { id } = req.params;
      const prisma = getPrisma();

      try {
        const competition = await prisma.competitions.findUnique({ where: { id } });
        if (!competition) {
          return res.json({ code: 40400, message: '比赛不存在', data: null });
        }
        // Disabling the button in the UI is not the rule — this is. A direct
        // call would otherwise mint an entry URL for a draft.
        if (competition.status === 'DRAFT') {
          return res.json({ code: 40041, message: '请先发布赛事，然后再生成访问链接', data: null });
        }

        // Generate a unique access code (retry on collision, extremely unlikely)
        let accessCode;
        let attempts = 0;
        do {
          accessCode = generateAccessCode();
          const existing = await prisma.competitions.findUnique({
            where: { competition_access_code: accessCode },
          });
          if (!existing) break;
          attempts++;
        } while (attempts < 5);

        // Update the competition with the new access code
        await prisma.competitions.update({
          where: { id },
          data: { competition_access_code: accessCode },
        });

        res.json({
          code: 200,
          message: 'success',
          data: {
            accessCode,
            entryUrl: buildEntryUrl(accessCode),
          },
        });
      } catch (e) {
        logger.error('Generate access link failed', { competitionId: id, error: e.message });
        res.json({ code: 50000, message: '生成访问链接失败', data: null });
      }
    }
  );

  /**
   * GET /:id/access-link — Retrieve the current access link for a competition.
   *
   * Returns null accessCode and null entryUrl if no link has been generated yet.
   *
   * Auth: Bearer token (org-scoped) + ORG_ADMIN role
   * Tenant: competition must belong to caller's organization
   *
   * Response:
   *   200 { code: 200, data: { accessCode, entryUrl } }
   *   404 { code: 40400 } — competition not found
   */
  router.get(
    '/:id/access-link',
    authMiddleware,
    roleMiddleware('ORG_ADMIN', 'SUPER_ADMIN'),
    tenantGuard('competitions'),
    async (req, res) => {
      const { id } = req.params;
      const prisma = getPrisma();

      try {
        const competition = await prisma.competitions.findUnique({
          where: { id },
          select: { id: true, name: true, competition_access_code: true },
        });

        if (!competition) {
          return res.json({ code: 40400, message: '比赛不存在', data: null });
        }

        const accessCode = competition.competition_access_code;
        res.json({
          code: 200,
          message: 'success',
          data: {
            accessCode,
            entryUrl: accessCode ? buildEntryUrl(accessCode) : null,
          },
        });
      } catch (e) {
        logger.error('Get access link failed', { competitionId: id, error: e.message });
        res.json({ code: 50000, message: '获取访问链接失败', data: null });
      }
    }
  );

  /**
   * DELETE /:id/access-link — Revoke the access link for a competition.
   *
   * Sets the competition_access_code to null, invalidating any existing entry links.
   *
   * Auth: Bearer token (org-scoped) + ORG_ADMIN role
   * Tenant: competition must belong to caller's organization
   *
   * Response:
   *   200 { code: 200, data: null }
   *   404 { code: 40400 } — competition not found
   */
  router.delete(
    '/:id/access-link',
    authMiddleware,
    roleMiddleware('ORG_ADMIN', 'SUPER_ADMIN'),
    tenantGuard('competitions'),
    async (req, res) => {
      const { id } = req.params;
      const prisma = getPrisma();

      try {
        const competition = await prisma.competitions.findUnique({ where: { id } });
        if (!competition) {
          return res.json({ code: 40400, message: '比赛不存在', data: null });
        }

        await prisma.competitions.update({
          where: { id },
          data: { competition_access_code: null },
        });

        res.json({ code: 200, message: 'success', data: null });
      } catch (e) {
        logger.error('Revoke access link failed', { competitionId: id, error: e.message });
        res.json({ code: 50000, message: '撤销访问链接失败', data: null });
      }
    }
  );

  // ── Public endpoint (no auth) ──

  /**
   * GET /by-code/:accessCode/info — Resolve an access code to basic competition info.
   *
   * Used by the frontend entry page (/competition/:accessCode) to display
   * competition name and status before the user logs in.
   *
   * No auth required — this is the landing page data.
   *
   * Response:
   *   200 { code: 200, data: { id, name, status, organizationName } }
   *   404 { code: 40400 } — access code not found
   */
  router.get('/by-code/:accessCode/info', async (req, res) => {
    const { accessCode } = req.params;
    const prisma = getPrisma();

    try {
      const competition = await prisma.competitions.findUnique({
        where: { competition_access_code: accessCode },
        select: {
          id: true,
          name: true,
          status: true,
          organizations: { select: { name: true } },
        },
      });

      if (!competition) {
        return res.json({ code: 40400, message: '比赛不存在', data: null });
      }

      res.json({
        code: 200,
        message: 'success',
        data: {
          id: competition.id,
          name: competition.name,
          status: competition.status,
          organizationName: competition.organizations?.name || null,
        },
      });
    } catch (e) {
      logger.error('Get competition by access code failed', { accessCode, error: e.message });
      res.json({ code: 50000, message: '获取比赛信息失败', data: null });
    }
  });

  // ── Competition-scoped login (no auth required) ──

  /**
   * POST /by-code/:identifier/login — Authenticate user for a specific competition.
   *
   * Takes an access code (or UUID) and credentials, verifies the user is registered
   * as a judge or player for that competition, and returns a competition-scoped JWT.
   *
   * No auth required — this is the entry point for competition participants.
   *
   * Response:
   *   200 { code: 200, data: { token, competition, user } }
   *   400 { code: 40001 } — missing credentials
   *   401 { code: 40001 } — wrong username/password
   *   403 { code: 40304 } — user not registered for this competition
   *   404 { code: 40400 } — competition not found
   */
  router.post('/by-code/:identifier/login', competitionLogin(repos));

  return router;
}

module.exports = { createCompetitionRouter };
