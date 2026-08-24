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
const { generatePuzzlesSchema, generateBulkSchema, importToRoundSchema, pdfConfirmSchema } = require('../validations/puzzleBank');
const PuzzleBankService = require('../services/PuzzleBankService');
const PdfImportService = require('../services/PdfImportService');
const { getPrisma } = require('../db/prisma');
const logger = require('../utils/logger');

// How long a stashed PDF preview stays around before we throw it away.
// One hour matches other short-lived tokens in the app and gives an admin
// enough time to read the preview + pick a round type without being rushed.
const PDF_STASH_TTL_MS = 60 * 60 * 1000;

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
  //   Phase 1 (upload): parse PDF → store parsed questions keyed by userId
  //   Phase 2 (confirm): admin picks roundType, puzzles get written to bank
  //
  // Each entry carries an `expiresAt` timestamp; entries older than
  // PDF_STASH_TTL_MS are dropped on the next access (BUG-PDF-08). This
  // stops a memory leak if admins upload without ever confirming.
  //
  // Cleared on server restart too (acceptable — admin just re-uploads).
  // NOTE: this in-memory cache is per-instance. If the server is ever
  // run behind a load balancer with multiple Node instances, phase 1
  // and phase 2 must land on the same instance (sticky session), OR the
  // stash needs to move to Redis.
  const pdfStash = new Map();

  function readStash(userId) {
    const entry = pdfStash.get(userId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      pdfStash.delete(userId);
      return null;
    }
    return entry;
  }

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

      // Stash parsed results keyed by userId — overwritten on each new
      // upload. expiresAt is checked on every read (BUG-PDF-08).
      pdfStash.set(req.user.userId, {
        questions,
        uploadedAt: new Date().toISOString(),
        expiresAt: Date.now() + PDF_STASH_TTL_MS,
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
  //
  // BUG-PDF-06: request body is validated by pdfConfirmSchema so a rogue
  //   `roundType` can never reach the bank untagged.
  // BUG-PDF-07: rate-limited with expensiveLimiter — the disk write is
  //   cheap per call, but a spammed loop of confirms could still churn
  //   the bank file. Same protection as the upload phase.
  // BUG-PDF-03: any categoryId inside the PDF is checked against the
  //   caller's organization; foreign categories are dropped to null
  //   rather than passed through (would leak an ID across tenants).
  // BUG-PDF-01: the "already-exists" check is scoped to this org, not
  //   the whole bank — otherwise the presence of a puzzle id in another
  //   org would silently skip the import AND leak that the id exists.
  router.post(
    '/puzzle-bank/import-pdf/confirm',
    expensiveLimiter,
    authMiddleware,
    roleMiddleware(...ADMIN_ROLES),
    validateBody(pdfConfirmSchema),
    async (req, res) => {
      const stash = readStash(req.user.userId);
      if (!stash) {
        return res.json({ code: 40020, message: '没有待确认的 PDF 导入，请先上传文件', data: null });
      }

      const { roundType } = req.body || {};
      const organizationId = req.user.organizationId;

      // BUG-PDF-03: collect every categoryId the PDF referenced and check
      // in one query that they all belong to the caller's org. Foreign
      // categories are stripped (set to null on the puzzle) — dropping
      // silently is safer than throwing, since a comité may have re-used
      // an old PDF with stale ids and we do not want to fail the batch.
      const referencedCategoryIds = [
        ...new Set(stash.questions.map(q => q.categoryId).filter(Boolean)),
      ];
      let validCategoryIds = new Set();
      if (referencedCategoryIds.length > 0) {
        try {
          const prisma = getPrisma();
          const owned = await prisma.categories.findMany({
            where: {
              id: { in: referencedCategoryIds },
              organization_id: organizationId,
            },
            select: { id: true },
          });
          validCategoryIds = new Set(owned.map(c => c.id));
        } catch (err) {
          logger.error('[puzzle-bank] category tenant check failed', { error: err.message });
          return res.json({ code: 50000, message: '校验类别失败，请稍后再试', data: null });
        }
      }

      const bank = puzzleBankService._load();
      const newPuzzles = [];
      let strippedCategoryCount = 0;

      for (const q of stash.questions) {
        // BUG-PDF-03: strip any categoryId the caller does not own.
        const safeQuestion =
          q.categoryId && !validCategoryIds.has(q.categoryId)
            ? (strippedCategoryCount++, { ...q, categoryId: null })
            : q;

        const entry = pdfImportService.toPuzzleBankEntry(
          safeQuestion,
          roundType || 'IMPORTED',
          organizationId
        );

        // BUG-PDF-01: only look at this org's puzzles when checking for
        // duplicates. Since the id is regenerated (BUG-PDF-02) collisions
        // are practically impossible now — this filter is defense in
        // depth for future changes.
        if (
          bank.puzzles.some(
            p => p.id === entry.id && p.organizationId === organizationId
          )
        ) {
          continue;
        }

        entry.orderInRound =
          bank.puzzles.filter(
            p => p.roundType === entry.roundType && p.organizationId === organizationId
          ).length +
          newPuzzles.filter(p => p.roundType === entry.roundType).length +
          1;
        newPuzzles.push(entry);
      }

      bank.puzzles.push(...newPuzzles);
      puzzleBankService._save();

      // Clear the stash after successful confirm — prevents double-confirm.
      pdfStash.delete(req.user.userId);

      res.json({
        code: 200,
        message: 'success',
        data: {
          imported: newPuzzles.length,
          skipped: stash.questions.length - newPuzzles.length,
          strippedCategoryIds: strippedCategoryCount,
          totalInBank: bank.puzzles.length,
          newPuzzleIds: newPuzzles.map(p => p.id),
        },
      });
    }
  );

  return router;
}

module.exports = { createPuzzleBankRouter };
