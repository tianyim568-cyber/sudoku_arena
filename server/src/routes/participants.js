/**
 * Participant import routes — handles Excel upload, preview, confirm, list, delete.
 * Follows the route factory pattern: createParticipantRouter(repos) returns express.Router().
 */

const express = require('express');
const multer = require('multer');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const ParticipantImportService = require('../services/ParticipantImportService');

// Configure multer for memory storage (file in req.file.buffer)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls'];
    const ext = file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .xlsx 和 .xls 格式'), false);
    }
  },
});

const importService = new ParticipantImportService();

function createParticipantRouter(repos) {
  const router = express.Router();

  // POST /api/tournaments/:id/participants/upload
  // Upload Excel, parse & validate, return preview data
  router.post(
    '/tournaments/:id/participants/upload',
    authMiddleware,
    roleMiddleware('ADMIN'),
    upload.single('file'),
    async (req, res) => {
      try {
        const tournamentId = parseInt(req.params.id);

        // Check tournament exists
        const tournament = await repos.tournaments.findById(tournamentId);
        if (!tournament) {
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
        console.error('Upload participants error:', err);
        res.json({ code: 50000, message: '选手导入失败', data: null });
      }
    }
  );

  // POST /api/tournaments/:id/participants/confirm
  // Confirm import, persist all rows in transaction
  router.post(
    '/tournaments/:id/participants/confirm',
    authMiddleware,
    roleMiddleware('ADMIN'),
    async (req, res) => {
      try {
        const tournamentId = parseInt(req.params.id);
        const { rows } = req.body;

        // Check tournament exists
        const tournament = await repos.tournaments.findById(tournamentId);
        if (!tournament) {
          return res.json({ code: 40404, message: '比赛不存在', data: null });
        }

        // Validate input
        if (!rows || !Array.isArray(rows) || rows.length === 0) {
          return res.json({ code: 40003, message: '没有有效的数据行', data: null });
        }

        // Bulk import — all-or-nothing transaction
        let result;
        try {
          result = await repos.participants.bulkImport(tournamentId, rows);
        } catch (importErr) {
          console.error('Bulk import rolled back:', importErr.message);
          return res.json({ code: 50001, message: '导入所有选手失败，已回滚全部操作', data: null });
        }

        res.json({
          code: 200,
          message: '选手导入成功',
          data: result,
        });
      } catch (err) {
        console.error('Confirm participants error:', err);
        res.json({ code: 50001, message: '选手导入失败', data: null });
      }
    }
  );

  // GET /api/tournaments/:id/participants
  // List imported participants for a tournament
  router.get(
    '/tournaments/:id/participants',
    authMiddleware,
    roleMiddleware('ADMIN'),
    async (req, res) => {
      try {
        const tournamentId = parseInt(req.params.id);

        // Check tournament exists
        const tournament = await repos.tournaments.findById(tournamentId);
        if (!tournament) {
          return res.json({ code: 40404, message: '比赛不存在', data: null });
        }

        const participants = await repos.participants.findByTournament(tournamentId);

        res.json({
          code: 200,
          message: 'success',
          data: participants,
        });
      } catch (err) {
        console.error('List participants error:', err);
        res.json({ code: 50002, message: '查询选手失败', data: null });
      }
    }
  );

  // DELETE /api/tournaments/:id/participants
  // Remove all imported participants for a tournament
  router.delete(
    '/tournaments/:id/participants',
    authMiddleware,
    roleMiddleware('ADMIN'),
    async (req, res) => {
      try {
        const tournamentId = parseInt(req.params.id);

        // Check tournament exists
        const tournament = await repos.tournaments.findById(tournamentId);
        if (!tournament) {
          return res.json({ code: 40404, message: '比赛不存在', data: null });
        }

        const count = await repos.participants.deleteByTournament(tournamentId);

        res.json({
          code: 200,
          message: 'success',
          data: { deleted: count },
        });
      } catch (err) {
        console.error('Delete participants error:', err);
        res.json({ code: 50003, message: '删除选手失败', data: null });
      }
    }
  );

  return router;
}

module.exports = { createParticipantRouter };
