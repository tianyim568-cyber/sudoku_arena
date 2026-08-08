const express = require('express');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { expensiveLimiter } = require('../middleware/rateLimiters');
const PuzzleBankService = require('../services/PuzzleBankService');

function createPuzzleBankRouter(repos) {
  const router = express.Router();
  const puzzleBankService = new PuzzleBankService(repos);

  // List puzzles in bank (with filters)
  router.get('/puzzle-bank', authMiddleware, (req, res) => {
    const { roundType, difficulty, puzzleType, limit, offset } = req.query;
    const data = puzzleBankService.listPuzzles({ roundType, difficulty, puzzleType, limit, offset });
    res.json({ code: 200, message: 'success', data });
  });

  // Get single puzzle detail (includes solution, ADMIN/JUDGE only)
  router.get('/puzzle-bank/:id', authMiddleware, roleMiddleware('ADMIN', 'JUDGE'), (req, res) => {
    const puzzle = puzzleBankService.getPuzzleDetail(req.params.id);
    if (!puzzle) return res.json({ code: 40400, message: '题目不存在', data: null });
    res.json({ code: 200, message: 'success', data: puzzle });
  });

  // Preview puzzle grid (for admin to check)
  router.get('/puzzle-bank/:id/preview', authMiddleware, roleMiddleware('ADMIN', 'JUDGE'), (req, res) => {
    const preview = puzzleBankService.getPuzzlePreview(req.params.id);
    if (!preview) return res.json({ code: 40400, message: '题目不存在', data: null });
    res.json({ code: 200, message: 'success', data: preview });
  });

  // Generate new puzzles and add to bank
  router.post('/puzzle-bank/generate', expensiveLimiter, authMiddleware, roleMiddleware('ADMIN'), (req, res) => {
    const { roundType, count, teamsCount } = req.body;
    if (!roundType) return res.json({ code: 40010, message: '缺少轮次类型', data: null });
    const data = puzzleBankService.generatePuzzles({ roundType, count, teamsCount });
    res.json({ code: 200, message: 'success', data });
  });

  // Bulk generate puzzles for ALL rounds at once (given team count)
  router.post('/puzzle-bank/generate-bulk', expensiveLimiter, authMiddleware, roleMiddleware('ADMIN'), (req, res) => {
    const { teamsCount } = req.body;
    if (!teamsCount || teamsCount < 1) return res.json({ code: 40010, message: '缺少队伍数量', data: null });
    const result = puzzleBankService.generateBulk(teamsCount);
    res.json({ code: 200, message: 'success', data: result });
  });

  // Import puzzles from bank into a round
  router.post('/puzzle-bank/import-to-round', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
    const { roundId, puzzleIds, count, teamsCount } = req.body;
    if (!roundId) return res.json({ code: 40010, message: '缺少轮次ID', data: null });

    const result = await puzzleBankService.importToRound({ roundId, puzzleIds, count, teamsCount });
    if (result.error) {
      return res.json({ code: result.code, message: result.error, data: result.existing != null ? { existing: result.existing } : null });
    }
    res.json({ code: 200, message: 'success', data: result });
  });

  // Delete single puzzle from bank
  router.delete('/puzzle-bank/:id', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
    const result = await puzzleBankService.deletePuzzle(req.params.id);
    if (!result.deleted) return res.json({ code: 40400, message: result.message, data: null });
    res.json({ code: 200, message: 'success', data: result });
  });

  // Clear all puzzles from bank
  router.delete('/puzzle-bank', authMiddleware, roleMiddleware('ADMIN'), async (req, res) => {
    const result = await puzzleBankService.clearAll();
    res.json({ code: 200, message: 'success', data: result });
  });

  return router;
}

module.exports = { createPuzzleBankRouter };
