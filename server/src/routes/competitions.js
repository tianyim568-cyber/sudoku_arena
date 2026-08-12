/**
 * competitions routes — access link generation and management.
 *
 * Endpoints for ORG_ADMIN to generate, retrieve, and revoke competition
 * entry links. Each link contains a unique 8-character access code that
 * resolves to a specific competition.
 *
 * Public endpoint allows anyone with the link to view basic competition info
 * (name, status) before logging in.
 *
 * Auth: generate/retrieve/revoke require org-scoped JWT + ORG_ADMIN role.
 *       The info endpoint is public (no auth).
 *
 * Route mounting:
 *   app.use('/api/competitions', createCompetitionRouter(repos));
 */

const express = require('express');
const crypto = require('crypto');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { getPrisma } = require('../db/prisma');
const { competitionLogin } = require('../middleware/competitionAuth');
const config = require('../config');

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

function createCompetitionRouter(repos) {
  const router = express.Router();

  // ── Protected endpoints (org-scoped auth + ORG_ADMIN) ──

  /**
   * POST /:id/access-link — Generate a new access link for a competition.
   *
   * If the competition already has an access code, it is replaced with a new one.
   * Returns the access code and the full entry URL.
   *
   * Auth: Bearer token (org-scoped) + ORG_ADMIN role
   * Tenant: competition must belong to caller's organization
   *
   * Response:
   *   200 { code: 200, data: { accessCode, entryUrl } }
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
        console.error('[competitions] generate access link error:', e.message);
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
        console.error('[competitions] get access link error:', e.message);
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
        console.error('[competitions] revoke access link error:', e.message);
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
      console.error('[competitions] get by code error:', e.message);
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
