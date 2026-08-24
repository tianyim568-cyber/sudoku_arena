/**
 * Puzzle Bank routes — generate, list, import-to-round, delete, and PDF import.
 *
 * PDF import follows the same two-phase pattern as participant import:
 * POST /puzzle-bank/import-pdf uploads and parses the PDF, returns a preview
 * of extracted questions. The admin reviews, then POST /puzzle-bank/import-pdf/confirm
 * writes the puzzles into the bank.
 */

const express = require('express');
const multer = require('multer');
const { authMiddleware, roleMiddleware, ADMIN_ROLES } = require('../middleware/auth');
const { expensiveLimiter } = require('../middleware/rateLimiters');
const { validateBody } = require('../middleware/validate');
const { validateFileType } = require('../middleware/fileType');
const { generatePuzzlesSchema, generateBulkSchema, importToRoundSchema } = require('../validations/puzzleBank');
const PuzzleBankService = require('../services/PuzzleBankService');
const PdfImportService = require('../services/PdfImportService');
const logger = require('../utils/logger');

// Multer config for PDF upload — 20MB max, PDF extension only.
// Magic-byte validation happens in validateFileType middleware downstream.
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (ext === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('仅支持 PDF 文件'));
    }
  },
});

function createPuzzleBankRouter(repos) {
  const router = express.Router();
  const puzzleBankService = new PuzzleBankService(repos);
  const pdfImportService = new PdfImportService();

  // In-memory stash for two-phase PDF import:
  //   Phase 1 (upload): parse PDF → store parsed questions keyed by a session token
  //   Phase 2 (confirm): admin picks roundType, puzzles get written to bank
  // Cleared on server restart (acceptable — admin just re-uploads).
  const pdfStash = new Map();

  // List puzzles in bank (with filters)
  router.get('/puzzle-bank', authMiddleware, (req, res) => {
    const { roundType, difficulty, puzzleType, limit, offset } = req.query;
    const data = puzzleBankService.listPuzzles({
      roundType, difficulty, puzzleType, limit, offset,
      organizationId: req.user.organizationId,
    });
    res.json({ code: 200, message: 'success', data });
  });

  // Get single puzzle detail (includes solution, ADMIN/JUDGE only)
  router.get('/puzzle-bank/:id', authMiddleware, roleMiddleware(...ADMIN_ROLES, 'JUDGE'), (req, res) => {
    const puzzle = puzzleBankService.getPuzzleDetail(req.params.id, req.user.organizationId);
    if (!puzzle) return res.json({ code: 40400, message: '题目不存在', data: null });
    res.json({ code: 200, message: 'success', data: puzzle });
  });

  // Preview puzzle grid (for admin to check)
  router.get('/puzzle-bank/:id/preview', authMiddleware, roleMiddleware(...ADMIN_ROLES, 'JUDGE'), (req, res) => {
    const preview = puzzleBankService.getPuzzlePreview(req.params.id, req.user.organizationId);
    if (!preview) return res.json({ code: 40400, message: '题目不存在', data: null });
    res.json({ code: 200, message: 'success', data: preview });
  });

  // Generate new puzzles and add to bank
  router.post('/puzzle-bank/generate', expensiveLimiter, authMiddleware, roleMiddleware(...ADMIN_ROLES), validateBody(generatePuzzlesSchema), (req, res) => {
    const { roundType, count, teamsCount } = req.body;
    const data = puzzleBankService.generatePuzzles({
      roundType, count, teamsCount,
      organizationId: req.user.organizationId,
    });
    res.json({ code: 200, message: 'success', data });
  });

  // Bulk generate puzzles for ALL rounds at once (given team count)
  router.post('/puzzle-bank/generate-bulk', expensiveLimiter, authMiddleware, roleMiddleware(...ADMIN_ROLES), validateBody(generateBulkSchema), (req, res) => {
    const { teamsCount } = req.body;
    const result = puzzleBankService.generateBulk(teamsCount, req.user.organizationId);
    res.json({ code: 200, message: 'success', data: result });
  });

  // Import puzzles from bank into a round
  router.post('/puzzle-bank/import-to-round', authMiddleware, roleMiddleware(...ADMIN_ROLES), validateBody(importToRoundSchema), async (req, res) => {
    const { roundId, puzzleIds, count, teamsCount } = req.body;

    const result = await puzzleBankService.importToRound({ roundId, puzzleIds, count, teamsCount });
    if (result.error) {
      return res.json({ code: result.code, message: result.error, data: result.existing != null ? { existing: result.existing } : null });
    }
    res.json({ code: 200, message: 'success', data: result });
  });

  // Delete single puzzle from bank
  router.delete('/puzzle-bank/:id', authMiddleware, roleMiddleware(...ADMIN_ROLES), async (req, res) => {
    const result = await puzzleBankService.deletePuzzle(req.params.id, req.user.organizationId);
    if (!result.deleted) return res.json({ code: 40400, message: result.message, data: null });
    res.json({ code: 200, message: 'success', data: result });
  });

  // Clear all puzzles from bank
  router.delete('/puzzle-bank', authMiddleware, roleMiddleware(...ADMIN_ROLES), async (req, res) => {
    const result = await puzzleBankService.clearAll(req.user.organizationId);
    res.json({ code: 200, message: 'success', data: result });
  });

  // ─── PDF Import (two-phase) ──────────────────────────────────────
  //
  // Phase 1: Upload + parse. The admin uploads a PDF; the server parses it
  // and returns the extracted questions as a preview. Nothing is written to
  // the bank yet — the admin must confirm.
  //
  // Phase 2: Confirm. The admin picks a roundType, and the server writes the
  // parsed questions into the puzzle bank.
  //
  // The stash is keyed by userId so concurrent admins don't collide.

  router.post(
    '/puzzle-bank/import-pdf',
    expensiveLimiter,
    authMiddleware,
    roleMiddleware(...ADMIN_ROLES),
    pdfUpload.single('file'),
    validateFileType(['pdf']),
    async (req, res) => {
      if (!req.file) {
        return res.json({ code: 40000, message: '请上传 PDF 文件', data: null });
      }

      const { questions, errors } = await pdfImportService.parsePdf(req.file.buffer);

      if (questions.length === 0) {
        return res.json({
          code: 40010,
          message: errors.length > 0 ? errors.join('; ') : '未能从 PDF 中提取任何题目',
          data: null,
        });
      }

      // Stash parsed results keyed by userId — overwritten on each new upload.
      pdfStash.set(req.user.id, {
        questions,
        uploadedAt: new Date().toISOString(),
        fileName: req.file.originalname,
      });

      res.json({
        code: 200,
        message: 'success',
        data: {
          parsed: questions.length,
          errors,
          fileName: req.file.originalname,
          // Send the parsed questions back for preview — the client renders
          // grids and metadata so the admin can review before confirming.
          questions: questions.map(q => ({
            id: q.id,
            type: q.type,
            difficulty: q.difficulty,
            score: q.score,
            categoryId: q.categoryId,
            initialGrid: q.initialGrid,
            // Don't send the solution in the preview response — the admin
            // sees it via getPuzzlePreview after import. This keeps the
            // preview payload small for large PDFs.
            emptyCellCount: q.initialGrid.flat().filter(v => v === 0).length,
          })),
        },
      });
    }
  );

  // Phase 2: confirm — write the stashed questions into the puzzle bank.
  //
  // The admin sends { roundType } to tag all imported puzzles with a target
  // round. Without it, they land as 'IMPORTED' — still visible in the bank,
  // but not matched by round-specific import-to-round logic.
  router.post(
    '/puzzle-bank/import-pdf/confirm',
    authMiddleware,
    roleMiddleware(...ADMIN_ROLES),
    async (req, res) => {
      const stash = pdfStash.get(req.user.id);
      if (!stash) {
        return res.json({ code: 40020, message: '没有待确认的 PDF 导入，请先上传文件', data: null });
      }

      const { roundType } = req.body || {};
      const organizationId = req.user.organizationId;

      const bank = puzzleBankService._load();
      const newPuzzles = [];

      for (const q of stash.questions) {
        // Skip if a puzzle with the same ID already exists in the bank
        // (duplicate PDF upload, or re-import of the same file).
        if (bank.puzzles.some(p => p.id === q.id)) continue;

        const entry = pdfImportService.toPuzzleBankEntry(q, roundType || 'IMPORTED', organizationId);
        entry.orderInRound = (bank.puzzles.filter(p => p.roundType === entry.roundType).length) + newPuzzles.filter(p => p.roundType === entry.roundType).length + 1;
        newPuzzles.push(entry);
      }

      bank.puzzles.push(...newPuzzles);
      puzzleBankService._save();

      // Clear the stash after successful confirm — prevents double-confirm.
      pdfStash.delete(req.user.id);

      res.json({
        code: 200,
        message: 'success',
        data: {
          imported: newPuzzles.length,
          skipped: stash.questions.length - newPuzzles.length,
          totalInBank: bank.puzzles.length,
          newPuzzleIds: newPuzzles.map(p => p.id),
        },
      });
    }
  );

  return router;
}

module.exports = { createPuzzleBankRouter };
