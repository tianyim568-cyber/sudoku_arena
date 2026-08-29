/**
 * Participant import routes — handles Excel upload, preview, confirm, list, delete.
 * Follows the route factory pattern: createParticipantRouter(repos) returns express.Router().
 *
 * Phase 9 of the second migration chantier: re-enabled with /competitions paths,
 * UUID-safe params (no parseInt), and tenantGuard('competitions') on every route.
 */

const express = require('express');
const multer = require('multer');
const { authMiddleware, roleMiddleware, ADMIN_ROLES } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { validateFileType } = require('../middleware/fileType');
const { expensiveLimiter } = require('../middleware/rateLimiters');
const { validateBody } = require('../middleware/validate');
const { confirmImportSchema, exportCredentialsSchema } = require('../validations/participants');
const ParticipantImportService = require('../services/ParticipantImportService');
const ParticipantExportService = require('../services/ParticipantExportService');
const logger = require('../utils/logger');

// Configure multer for memory storage (file in req.file.buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv'];
    const ext = file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .xlsx、.xls 和 .csv 格式'), false);
    }
  },
});

const importService = new ParticipantImportService();
const exportService = new ParticipantExportService();

function createParticipantRouter(repos) {
  const router = express.Router();

  // GET /api/participants — global list across every competition of the
  // caller's organization. Read-only; import/delete/export remain on the
  // per-competition routes below.
  //
  // SECURITY (tenant isolation): this route intentionally does NOT go
  // through tenantGuard('competitions') because it is not scoped to a
  // single competition id. The tenant guard is the WHERE clause below —
  // every row returned must belong to a competition owned by the
  // caller's org. Any change to that clause is a tenant-isolation
  // change and needs Louise's review.
  //
  // Query params (all optional):
  //   competitionId — restrict to one competition; the org filter still
  //                   applies, so a request for another org's
  //                   competition returns [].
  //   categoryId    — filter by player category
  //   search        — case-insensitive substring on name OR school
  //
  // Pagination is intentionally NOT implemented: real-world org sizes
  // (a few hundred participants max) fit in a single response, and the
  // page does client-side rendering of a compact table. Add limit/offset
  // if that ever grows past ~500.
  router.get(
    '/participants',
    authMiddleware,
    roleMiddleware(...ADMIN_ROLES),
    async (req, res) => {
      try {
        const { getPrisma } = require('../db/prisma');
        const prisma = getPrisma();
        const { competitionId, categoryId, search } = req.query;

        // The tenant guard. ORG_ADMIN sees only their org; SUPER_ADMIN
        // sees every org. The nested `competitions:` clause forces a
        // join and applies organization_id at the parent level.
        const where = {
          competitions: req.user.role === 'SUPER_ADMIN'
            ? {}
            : { organization_id: req.user.organizationId },
        };

        if (competitionId && typeof competitionId === 'string') {
          where.competition_id = competitionId;
        }
        if (categoryId && typeof categoryId === 'string') {
          where.category_id = categoryId;
        }
        if (search && typeof search === 'string' && search.trim()) {
          const term = search.trim();
          where.OR = [
            { name:   { contains: term, mode: 'insensitive' } },
            { school: { contains: term, mode: 'insensitive' } },
          ];
        }

        const participants = await prisma.players.findMany({
          where,
          select: {
            id: true,
            name: true,
            school: true,
            age: true,
            province: true,
            city: true,
            created_at: true,
            categories: { select: { id: true, name: true } },
            competitions: { select: { id: true, name: true, status: true } },
          },
          orderBy: [
            { competitions: { created_at: 'desc' } },
            { name: 'asc' },
          ],
        });

        // Flatten relations into a predictable row shape for the page.
        const rows = participants.map(p => ({
          id: p.id,
          name: p.name,
          school: p.school,
          age: p.age,
          province: p.province,
          city: p.city,
          createdAt: p.created_at,
          categoryId: p.categories?.id || null,
          categoryName: p.categories?.name || null,
          competitionId: p.competitions.id,
          competitionName: p.competitions.name,
          competitionStatus: p.competitions.status,
        }));

        res.json({ code: 200, message: 'success', data: rows });
      } catch (err) {
        logger.error('List global participants failed', { error: err.message });
        res.json({ code: 50000, message: '查询选手失败', data: null });
      }
    }
  );

  // GET /api/teams — global list across every competition of the caller's
  // organization. Read-only; team CRUD (create, add/remove members) remains
  // on the per-competition routes in competitionSetup.js.
  //
  // SECURITY (tenant isolation): same pattern as GET /participants above.
  // The WHERE clause filters by competitions.organization_id — every row
  // returned must belong to the caller's org. SUPER_ADMIN sees every org.
  //
  // Query params (all optional):
  //   competitionId — restrict to one competition
  //   search        — case-insensitive substring on team name
  router.get(
    '/teams',
    authMiddleware,
    roleMiddleware(...ADMIN_ROLES),
    async (req, res) => {
      try {
        const { competitionId, search } = req.query;
        const filters = {};
        if (competitionId && typeof competitionId === 'string') {
          filters.competitionId = competitionId;
        }
        if (search && typeof search === 'string' && search.trim()) {
          filters.search = search.trim();
        }

        // SUPER_ADMIN sees every org; ORG_ADMIN sees only their own.
        const orgId = req.user.role === 'SUPER_ADMIN' ? null : req.user.organizationId;
        const rows = await repos.teams.findByOrganization(orgId, filters);

        res.json({ code: 200, message: 'success', data: rows });
      } catch (err) {
        logger.error('List global teams failed', { error: err.message });
        res.json({ code: 50000, message: '查询队伍失败', data: null });
      }
    }
  );

  // POST /api/competitions/:id/participants/upload
  // Upload Excel, parse & validate, return preview data
  router.post(
    '/competitions/:id/participants/upload',
    expensiveLimiter,
    authMiddleware,
    tenantGuard('competitions'),
    roleMiddleware(...ADMIN_ROLES),
    upload.single('file'),
    validateFileType(['xlsx', 'xls', 'csv']),
    async (req, res) => {
      try {
        const competitionId = req.params.id;

        // Check competition exists
        const competition = await repos.competitions.findById(competitionId);
        if (!competition) {
          return res.json({ code: 40404, message: '比赛不存在', data: null });
        }

        // Check file uploaded
        if (!req.file) {
          return res.json({ code: 40000, message: '请上传Excel文件', data: null });
        }

        // Parse Excel
        let parsed;
        try {
          parsed = importService.parseExcel(req.file.buffer);
        } catch (err) {
          return res.json({ code: 40001, message: err.message, data: null });
        }

        // Validate rows
        const { valid, invalid } = importService.validateRows(parsed.rows);

        if (valid.length === 0) {
          return res.json({ code: 40002, message: '没有有效的数据行', data: null });
        }

        // Return preview data (no DB writes yet)
        res.json({
          code: 200,
          message: 'success',
          data: {
            valid,
            invalid,
            total: parsed.rows.length,
          },
        });
      } catch (err) {
        logger.error('Upload participants failed', { error: err.message });
        res.json({ code: 50000, message: '选手导入失败', data: null });
      }
    }
  );

  // POST /api/competitions/:id/participants/confirm
  // Confirm import, persist all rows in transaction
  router.post(
    '/competitions/:id/participants/confirm',
    authMiddleware,
    tenantGuard('competitions'),
    roleMiddleware(...ADMIN_ROLES),
    validateBody(confirmImportSchema),
    async (req, res) => {
      try {
        const competitionId = req.params.id;
        const { rows } = req.body;

        // Check competition exists
        const competition = await repos.competitions.findById(competitionId);
        if (!competition) {
          return res.json({ code: 40404, message: '比赛不存在', data: null });
        }

        // Zod already verified `rows` is a non-empty array of objects with
        // name + school. Re-run the service's deeper validation (age range,
        // etc.) on every row, never trusting the client.
        const { valid, invalid } = importService.validateRows(rows);
        if (invalid.length > 0) {
          return res.json({ code: 40003, message: '存在无效的数据行，无法导入', data: { invalid } });
        }

        // Extract year from competition creation date
        const year = competition.created_at ? new Date(competition.created_at).getFullYear().toString() : new Date().getFullYear().toString();

        // Bulk import — all-or-nothing transaction (only re-validated rows)
        let result;
        try {
          result = await repos.participants.bulkImport(competitionId, valid, year);
        } catch (importErr) {
          logger.error('Bulk import rolled back', { error: importErr.message });
          return res.json({ code: 50001, message: '导入所有选手失败，已回滚全部操作', data: null });
        }

        res.json({
          code: 200,
          message: '选手导入成功',
          data: result,
        });
      } catch (err) {
        logger.error('Confirm participants failed', { error: err.message });
        res.json({ code: 50001, message: '选手导入失败', data: null });
      }
    }
  );

  // GET /api/competitions/:id/participants
  // List imported participants for a competition
  router.get(
    '/competitions/:id/participants',
    authMiddleware,
    tenantGuard('competitions'),
    roleMiddleware(...ADMIN_ROLES),
    async (req, res) => {
      try {
        const competitionId = req.params.id;

        // Check competition exists
        const competition = await repos.competitions.findById(competitionId);
        if (!competition) {
          return res.json({ code: 40404, message: '比赛不存在', data: null });
        }

        const participants = await repos.participants.findByCompetition(competitionId);

        res.json({
          code: 200,
          message: 'success',
          data: participants,
        });
      } catch (err) {
        logger.error('List participants failed', { error: err.message });
        res.json({ code: 50002, message: '查询选手失败', data: null });
      }
    }
  );

  // DELETE /api/competitions/:id/participants
  // Remove all imported participants for a competition
  router.delete(
    '/competitions/:id/participants',
    authMiddleware,
    tenantGuard('competitions'),
    roleMiddleware(...ADMIN_ROLES),
    async (req, res) => {
      try {
        const competitionId = req.params.id;

        // Check competition exists
        const competition = await repos.competitions.findById(competitionId);
        if (!competition) {
          return res.json({ code: 40404, message: '比赛不存在', data: null });
        }

        const count = await repos.participants.deleteByCompetition(competitionId);

        res.json({
          code: 200,
          message: 'success',
          data: { deleted: count },
        });
      } catch (err) {
        logger.error('Delete participants failed', { error: err.message });
        res.json({ code: 50003, message: '删除选手失败', data: null });
      }
    }
  );

  // POST /api/competitions/:id/participants/export
  // Export credentials as Excel file.
  //
  // Design (2026-08-26, Louise option B): the plain-text password is only
  // alive in memory between /confirm and /export. The client captures the
  // credentials array from the /confirm response and sends it back here in
  // the body. The server never persists plain-text passwords — it only
  // generates the Excel buffer from what the client sends.
  //
  // The tenant guard still applies: the :id must belong to the caller's
  // org. The credentials themselves are cross-checked against the players
  // actually registered for that competition, so an admin cannot use this
  // route to exfiltrate credentials from another org by crafting the body.
  router.post(
    '/competitions/:id/participants/export',
    authMiddleware,
    tenantGuard('competitions'),
    roleMiddleware(...ADMIN_ROLES),
    validateBody(exportCredentialsSchema),
    async (req, res) => {
      try {
        const competitionId = req.params.id;
        const { credentials } = req.body;

        // Check competition exists
        const competition = await repos.competitions.findById(competitionId);
        if (!competition) {
          return res.json({ code: 40404, message: '比赛不存在', data: null });
        }

        // Tenant guard on the credentials themselves: each username in the
        // body must belong to a player registered for THIS competition.
        // Without this check, an admin from org A could send credentials
        // from org B (if they had captured them somehow) and generate an
        // Excel from this route. The check is O(N) usernames against the
        // players table, which is fine for the 1000-row cap.
        const usernames = credentials.map((c) => c.username);
        const { getPrisma } = require('../db/prisma');
        const prisma = getPrisma();
        const knownPlayers = await prisma.players.findMany({
          where: {
            competition_id: competitionId,
            users: { username: { in: usernames } },
          },
          select: { users: { select: { username: true } } },
        });
        const knownUsernames = new Set(knownPlayers.map((p) => p.users?.username).filter(Boolean));
        const foreignCount = usernames.filter((u) => !knownUsernames.has(u)).length;
        if (foreignCount > 0) {
          logger.warn('Export refused: foreign credentials in body', {
            competitionId,
            foreignCount,
            requester: req.user?.id,
          });
          return res.json({
            code: 40030,
            message: '认证失败：部分账号不属于此比赛',
            data: null,
          });
        }

        // Generate Excel buffer
        const rows = credentials.map((c) => ({
          id: '-',
          school_name: c.school || '-',
          name: c.name,
          category: '-',
          account: c.username,
          password: c.password,
        }));
        const buffer = exportService.generateExportBuffer(rows);

        // Set download headers
        const filename = encodeURIComponent(`${competition.name}_选手账号密码.xlsx`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
        logger.info('Export credentials generated', {
          competitionId,
          count: credentials.length,
          requester: req.user?.id,
        });
        res.send(buffer);
      } catch (err) {
        logger.error('Export participants failed', { error: err.message });
        res.json({ code: 50004, message: '导出选手信息失败', data: null });
      }
    }
  );

  // GET /api/search — global search across participants, teams, competitions.
  // Returns grouped results (max 10 per type) with tenant isolation.
  //
  // SECURITY: Same pattern as /participants and /teams — the WHERE clause
  // filters by organization_id, so ORG_ADMIN only sees their own org's data.
  // SUPER_ADMIN sees everything (orgId = null → skip org filter).
  //
  // Query params:
  //   q — search term (case-insensitive substring match)
  router.get(
    '/search',
    authMiddleware,
    roleMiddleware(...ADMIN_ROLES),
    async (req, res) => {
      try {
        const { q } = req.query;
        if (!q || typeof q !== 'string' || q.trim().length < 2) {
          return res.json({ code: 40001, message: '搜索词至少2个字符', data: null });
        }

        const term = q.trim();
        const orgId = req.user.role === 'SUPER_ADMIN' ? null : req.user.organizationId;

        // Parallel search across three tables
        const [participants, teams, competitions] = await Promise.all([
          // Participants: search by name (real_name) or username
          repos.prisma.participants.findMany({
            where: {
              ...(orgId ? { competitions: { organization_id: orgId } } : {}),
              OR: [
                { real_name: { contains: term, mode: 'insensitive' } },
                { username: { contains: term, mode: 'insensitive' } },
              ],
            },
            include: {
              competitions: { select: { id: true, name: true } },
            },
            take: 10,
          }),
          // Teams: search by name
          repos.prisma.teams.findMany({
            where: {
              ...(orgId ? { competitions: { organization_id: orgId } } : {}),
              name: { contains: term, mode: 'insensitive' },
            },
            include: {
              competitions: { select: { id: true, name: true } },
              _count: { select: { team_members: true } },
            },
            take: 10,
          }),
          // Competitions: search by name
          repos.prisma.competitions.findMany({
            where: {
              ...(orgId ? { organization_id: orgId } : {}),
              name: { contains: term, mode: 'insensitive' },
            },
            select: {
              id: true,
              name: true,
              status: true,
              start_date: true,
            },
            take: 10,
          }),
        ]);

        res.json({
          code: 200,
          message: 'success',
          data: {
            participants: participants.map(p => ({
              id: p.id,
              name: p.real_name || p.username,
              username: p.username,
              competitionId: p.competitions?.id,
              competitionName: p.competitions?.name,
            })),
            teams: teams.map(t => ({
              id: t.id,
              name: t.name,
              competitionId: t.competitions?.id,
              competitionName: t.competitions?.name,
              memberCount: t._count?.team_members || 0,
            })),
            competitions: competitions.map(c => ({
              id: c.id,
              name: c.name,
              status: c.status,
              startDate: c.start_date,
            })),
          },
        });
      } catch (err) {
        logger.error('Global search failed', { error: err.message });
        res.json({ code: 50000, message: '搜索失败', data: null });
      }
    }
  );

  return router;
}

module.exports = { createParticipantRouter };
