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

  // Phase 2: confirm — write the stashed questions into the puzzle bank
  // AND immediately import them into the target round.
  //
  // Product decision 2026-08-24: every batch of PDF puzzles must be tied
  // to a specific round (roundId, not roundType). There is no "generic
  // pool" any more — a puzzle uploaded for round R belongs to R and
  // nowhere else. This is what the request body carries, what the route
  // enforces, and what makes the puzzle bank consistent with the round
  // list from an admin's mental model.
  //
  // Guarantees checked here:
  //   PDF-01 org-scoped duplicate check + org-scoped orderInRound counter.
  //   PDF-03 categoryId cross-tenant validation (foreign ids stripped).
  //   PDF-06 request body validated by pdfConfirmSchema (roundId is a UUID).
  //   PDF-07 rate-limited with expensiveLimiter.
  //   Round tenant guard: the round must belong to a competition owned
  //     by the caller's organization. Anything else is 403.
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

      const { roundId } = req.body;
      const organizationId = req.user.organizationId;
      const prisma = getPrisma();

      // Fetch the round + its competition's org in one query. If the
      // competition doesn't belong to the caller, we return 403 without
      // leaking whether the round even exists.
      let round;
      try {
        round = await prisma.rounds.findUnique({
          where: { id: roundId },
          select: {
            id: true,
            round_type: true,
            competition_stages: {
              select: { competitions: { select: { organization_id: true } } },
            },
          },
        });
      } catch (err) {
        logger.error('[puzzle-bank] round lookup failed', { error: err.message });
        return res.json({ code: 50000, message: '校验轮次失败，请稍后再试', data: null });
      }
      if (!round) {
        return res.json({ code: 40400, message: '轮次不存在', data: null });
      }
      const roundOrgId = round.competition_stages?.competitions?.organization_id;
      if (roundOrgId !== organizationId) {
        return res.json({ code: 40301, message: '无权在此轮次导入题目', data: null });
      }

      // Refuse to overwrite a round that already has puzzles — matches the
      // existing importToRound rule. Prevents an admin from wiping their
      // work by mistake with a new PDF upload.
      let existingCount = 0;
      try {
        existingCount = await repos.puzzles.countByRound(roundId);
      } catch (err) {
        logger.error('[puzzle-bank] countByRound failed', { error: err.message });
        return res.json({ code: 50000, message: '校验轮次失败，请稍后再试', data: null });
      }
      if (existingCount > 0) {
        return res.json({
          code: 40030,
          message: '该轮次已有题目，请先清除再导入',
          data: { existing: existingCount },
        });
      }

      // PDF-03: check every referenced categoryId against the caller's org
      // in one query. Foreign ids get stripped rather than passing through.
      const referencedCategoryIds = [
        ...new Set(stash.questions.map(q => q.categoryId).filter(Boolean)),
      ];
      let validCategoryIds = new Set();
      if (referencedCategoryIds.length > 0) {
        try {
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
        const safeQuestion =
          q.categoryId && !validCategoryIds.has(q.categoryId)
            ? (strippedCategoryCount++, { ...q, categoryId: null })
            : q;

        // Tag every puzzle with the round's actual type so
        // `importToRound` can match them.
        const entry = pdfImportService.toPuzzleBankEntry(
          safeQuestion,
          round.round_type,
          organizationId
        );

        // PDF-01: scoped duplicate check (defense in depth — ids are
        // regenerated via crypto.randomUUID so collisions are astronomical).
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

      // Auto-import into the target round. Guarantees the "every batch
      // belongs to one round" rule at write time: an admin never has a
      // window where the PDF puzzles are in the bank but not in a round.
      let importResult = { imported: 0 };
      try {
        importResult = await puzzleBankService.importToRound({
          roundId,
          puzzleIds: newPuzzles.map(p => p.id),
        });
      } catch (err) {
        logger.error('[puzzle-bank] importToRound after PDF confirm failed', {
          error: err.message, roundId,
        });
        // The bank has been written — return partial success so the admin
        // knows to re-run the round-import manually.
        return res.json({
          code: 50001,
          message: '题目已入库，但导入到轮次失败，请手动重试',
          data: {
            imported: newPuzzles.length,
            importedToRound: 0,
            totalInBank: bank.puzzles.length,
            newPuzzleIds: newPuzzles.map(p => p.id),
          },
        });
      }

      // Clear the stash after a fully successful confirm.
      pdfStash.delete(req.user.userId);

      res.json({
        code: 200,
        message: 'success',
        data: {
          imported: newPuzzles.length,
          importedToRound: importResult.imported || newPuzzles.length,
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
