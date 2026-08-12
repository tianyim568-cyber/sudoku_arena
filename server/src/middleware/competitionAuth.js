/**
 * competitionAuth — competition-scoped authentication utilities.
 *
 * This module provides:
 *   - generateCompetitionToken() — re-exported from auth.js
 *   - competitionAuth middleware — enforces competition-scoped tokens only
 *   - competitionLogin() — route handler factory for competition entry login
 *
 * The unified authMiddleware in auth.js already handles both token types
 * and populates req.competition for competition tokens. This middleware
 * adds an extra check: it REJECTS org-scoped tokens, ensuring only
 * competition-scoped tokens can access competition-specific routes.
 */

const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { authMiddleware, generateCompetitionToken } = require('./auth');
const { getPrisma } = require('../db/prisma');

// Zod schema for competition login
const competitionLoginSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
});

// ── Middleware ──

/**
 * Middleware that enforces competition-scoped JWTs only.
 *
 * Uses authMiddleware internally to validate the token and populate req.user.
 * Then adds an extra check: req.competition must exist (i.e. the token must
 * be competition-scoped). Org-scoped tokens are rejected with 403.
 *
 * After this middleware runs:
 *   req.user = { userId, username, role, organizationId }
 *   req.competition = { competitionId, userId, role, participantId, organizationId }
 *
 * Responses:
 *   401 { code: 40101 } — no Authorization header
 *   401 { code: 40102 } — token invalid or expired
 *   403 { code: 40303 } — token is valid but not competition-scoped
 */
function competitionAuth(req, res, next) {
  // Use authMiddleware to validate and populate req.user
  authMiddleware(req, res, () => {
    // Check that this is a competition-scoped token
    if (!req.competition) {
      return res.status(403).json({
        code: 40303,
        message: '此令牌不是比赛专用令牌',
        data: null,
      });
    }
    next();
  });
}

// ── Login handler factory ──

/**
 * Returns an Express route handler for competition-scoped login.
 *
 * POST /competitions/:identifier/login
 * Body: { username, password }
 *
 * Flow:
 *   1. Look up the competition by `:identifier` (UUID or access_code)
 *   2. Authenticate the user with username + password
 *   3. Check if the user is a registered judge or player for this competition
 *   4. If authorized, issue a competition-scoped JWT
 *
 * The `:identifier` param supports both:
 *   - Competition UUID (for direct links)
 *   - Access code / URL slug (for the future link-generation feature)
 *
 * Responses:
 *   200 { code: 200, data: { token, competition, user } }
 *   401 { code: 40001 } — missing credentials
 *   401 { code: 40001 } — wrong username/password
 *   403 { code: 40304 } — user not registered for this competition
 *   404 { code: 40400 } — competition not found
 */
function competitionLogin(repos) {
  return async (req, res) => {
    const { identifier } = req.params;

    // Validate input with Zod
    const validation = competitionLoginSchema.safeParse(req.body);
    if (!validation.success) {
      const firstError = validation.error.issues?.[0]?.message ||
                         validation.error.errors?.[0]?.message ||
                         'Validation failed';
      return res.json({ code: 40001, message: firstError, data: null });
    }

    const { username, password } = validation.data;

    if (!identifier) {
      return res.json({ code: 40001, message: '缺少比赛标识', data: null });
    }

    const prisma = getPrisma();

    // Check if identifier is a UUID (has dashes) or access code
    const isUuid = identifier.length === 36 && identifier.includes('-');

    try {
      // 2. Find the competition by UUID or access_code
      const competition = await prisma.competitions.findFirst({
        where: isUuid
          ? { id: identifier }
          : { competition_access_code: identifier },
        include: {
          organizations: { select: { id: true, name: true, status: true } },
        },
      });

      if (!competition) {
        return res.json({ code: 40400, message: '比赛不存在', data: null });
      }

      // 3. Authenticate the user
      const user = await repos.users.findByUsername(username);
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.json({ code: 40001, message: '用户名或密码错误', data: null });
      }

      // 4. Determine the user's role in this competition
      let role = null;
      let participantId = null;

      // Check if the user is a judge for this competition
      const judgeEntry = await prisma.competition_judges.findFirst({
        where: {
          competition_id: competition.id,
          user_id: user.id,
        },
      });

      if (judgeEntry) {
        role = 'JUDGE';
      } else {
        // Check if the user is a player (participant) for this competition
        const playerEntry = await prisma.players.findFirst({
          where: {
            competition_id: competition.id,
            user_id: user.id,
          },
        });

        if (playerEntry) {
          role = 'PLAYER';
          participantId = playerEntry.id;
        }
      }

      // 5. Deny access if the user has no role in this competition
      if (!role) {
        return res.status(403).json({
          code: 40304,
          message: '您未注册参加此比赛',
          data: null,
        });
      }

      // 6. Issue competition-scoped JWT
      const token = generateCompetitionToken({
        competitionId: competition.id,
        userId: user.id,
        role,
        participantId,
        organizationId: competition.organization_id,
      });

      res.json({
        code: 200,
        message: 'success',
        data: {
          token,
          competition: {
            id: competition.id,
            name: competition.name,
            status: competition.status,
          },
          user: {
            id: user.id,
            username: user.username,
            role,
            participantId,
          },
        },
      });
    } catch (e) {
      console.error('[competitionLogin] Error:', e.message);
      res.json({ code: 50000, message: '比赛登录失败，请稍后重试', data: null });
    }
  };
}

module.exports = { competitionAuth, competitionLogin, generateCompetitionToken };
