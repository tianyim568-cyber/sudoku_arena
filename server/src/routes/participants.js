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
const { confirmImportSchema } = require('../validations/participants');
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

  // GET /api/competitions/:id/participants/export
  // Export participants with credentials as Excel file
  router.get(
    '/competitions/:id/participants/export',
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

        // Get export data
        const rows = await repos.participants.getExportData(competitionId);

        if (rows.length === 0) {
          return res.json({ code: 40004, message: '没有可导出的选手数据', data: null });
        }

        // Generate Excel buffer
        const buffer = exportService.generateExportBuffer(rows);

        // Set download headers
        const filename = encodeURIComponent(`${competition.name}_选手账号密码.xlsx`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
        res.send(buffer);
      } catch (err) {
        logger.error('Export participants failed', { error: err.message });
        res.json({ code: 50004, message: '导出选手信息失败', data: null });
      }
    }
  );

  return router;
}

module.exports = { createParticipantRouter };
