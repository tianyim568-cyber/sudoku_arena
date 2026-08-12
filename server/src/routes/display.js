/**
 * Display routes — big-screen display token management and public ranking data.
 *
 * Endpoints:
 *   POST /competitions/:id/display-token — Generate display token (ORG_ADMIN)
 *   DELETE /competitions/:id/display-token — Revoke display token (ORG_ADMIN)
 *   GET /display/:token/ranking — Public ranking snapshot (no auth)
 *
 * Display tokens allow unauthenticated access to competition rankings
 * for big-screen displays.
 */

const express = require('express');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');

function createDisplayRouter(displayManager) {
  const router = express.Router();

  // ── Protected endpoints (org-scoped auth + ORG_ADMIN) ──

  /**
   * POST /competitions/:id/display-token — Generate a new display token.
   *
   * Auth: Bearer token (org-scoped) + ORG_ADMIN role
   * Tenant: competition must belong to caller's organization
   *
   * Response:
   *   200 { code: 200, data: { token, displayUrl } }
   *   404 { code: 40400 } — competition not found
   */
  router.post(
    '/competitions/:id/display-token',
    authMiddleware,
    roleMiddleware('ORG_ADMIN', 'SUPER_ADMIN'),
    tenantGuard('competitions'),
    async (req, res) => {
      const { id } = req.params;

      try {
        const token = await displayManager.generateToken(id);
        const displayUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/display/${token}`;

        res.json({
          code: 200,
          message: 'success',
          data: { token, displayUrl },
        });
      } catch (e) {
        console.error('[display] generate token error:', e.message);
        res.json({ code: 50000, message: '生成显示令牌失败', data: null });
      }
    }
  );

  /**
   * DELETE /competitions/:id/display-token — Revoke the display token.
   *
   * Auth: Bearer token (org-scoped) + ORG_ADMIN role
   * Tenant: competition must belong to caller's organization
   *
   * Response:
   *   200 { code: 200, data: null }
   *   404 { code: 40400 } — competition not found
   */
  router.delete(
    '/competitions/:id/display-token',
    authMiddleware,
    roleMiddleware('ORG_ADMIN', 'SUPER_ADMIN'),
    tenantGuard('competitions'),
    async (req, res) => {
      const { id } = req.params;

      try {
        await displayManager.revokeToken(id);
        res.json({ code: 200, message: 'success', data: null });
      } catch (e) {
        console.error('[display] revoke token error:', e.message);
        res.json({ code: 50000, message: '撤销显示令牌失败', data: null });
      }
    }
  );

  // ── Public endpoint (no auth) ──

  /**
   * GET /display/:token/ranking — Public ranking snapshot.
   *
   * Query params:
   *   ?categoryId=<uuid> — filter by category (optional)
   *
   * No auth required — uses display token for access control.
   *
   * Response:
   *   200 { code: 200, data: { competition, categories, stages, rankings } }
   *   401 { code: 40102 } — invalid display token
   */
  router.get('/display/:token/ranking', async (req, res) => {
    const { token } = req.params;
    const { categoryId } = req.query;

    try {
      // Verify display token
      const competitionId = await displayManager.verifyToken(token);
      if (!competitionId) {
        return res.status(401).json({
          code: 40102,
          message: '显示令牌无效',
          data: null,
        });
      }

      // Get ranking snapshot
      const snapshot = await displayManager.getRankingSnapshot(competitionId, categoryId || null);

      res.json({
        code: 200,
        message: 'success',
        data: snapshot,
      });
    } catch (e) {
      console.error('[display] get ranking error:', e.message);
      res.json({ code: 50000, message: '获取排行榜失败', data: null });
    }
  });

  return router;
}

module.exports = { createDisplayRouter };
