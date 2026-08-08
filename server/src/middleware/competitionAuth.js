/**
 * competitionAuth — competition-scoped authentication middleware.
 *
 * Issues and validates JWTs that are scoped to a specific competition.
 * Used by judges and players who access the platform via a competition-specific
 * entry point (e.g. /competition/{identifier}) rather than the org dashboard.
 *
 * Two token types coexist in the system:
 *   - Org-scoped:    { userId, username, role, organizationId }
 *   - Competition-scoped: { type: 'competition', competitionId, userId, role,
 *                           participantId, organizationId }
 *
 * The middleware chain for a competition route looks like:
 *   router.get('/rounds', competitionAuth, handler)
 *
 * After competitionAuth runs, `req.competition` is populated with:
 *   { competitionId, userId, role, participantId, organizationId }
 *
 * Usage:
 *   const { competitionAuth, competitionLogin } = require('../middleware/competitionAuth');
 *
 *   // Login endpoint (POST /competitions/:identifier/login)
 *   router.post('/competitions/:identifier/login', competitionLogin(repos));
 *
 *   // Protected competition endpoints
 *   router.get('/competitions/:id/rounds', competitionAuth, listRounds);
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { getPrisma } = require('../db/prisma');

// ── Token generation ──

/**
 * Generate a competition-scoped JWT.
 *
 * @param {object} params
 * @param {string} params.competitionId - UUID of the competition
 * @param {string} params.userId - UUID of the user account
 * @param {string} params.role - 'JUDGE' or 'PLAYER'
 * @param {string|null} params.participantId - UUID from players table (null for judges)
 * @param {string} params.organizationId - UUID of the owning organization
 * @returns {string} signed JWT
 */
function generateCompetitionToken({ competitionId, userId, role, participantId, organizationId }) {
  return jwt.sign(
    {
      type: 'competition',
      competitionId,
      userId,
      role,
      participantId: participantId || null,
      organizationId,
    },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );
}

// ── Middleware ──

/**
 * Middleware that validates a competition-scoped JWT.
 *
 * Extracts the Bearer token, verifies it, and checks that it is a
 * competition-type token. On success, attaches `req.competition` with
 * the decoded context and calls next().
 *
 * Must be used AFTER the route is matched — it does NOT call authMiddleware
 * internally. It is a standalone validator for competition tokens.
 *
 * Responses:
 *   401 { code: 40101 } — no Authorization header
 *   401 { code: 40102 } — token invalid or expired
 *   403 { code: 40303 } — token is valid but not competition-scoped
 */
function competitionAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 40101, message: '未登录', data: null });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);

    if (decoded.type !== 'competition') {
      return res.status(403).json({
        code: 40303,
        message: '此令牌不是比赛专用令牌',
        data: null,
      });
    }

    // Attach competition context to the request
    req.competition = {
      competitionId: decoded.competitionId,
      userId: decoded.userId,
      role: decoded.role,
      participantId: decoded.participantId,
      organizationId: decoded.organizationId,
    };

    next();
  } catch (e) {
    return res.status(401).json({ code: 40102, message: 'Token无效或已过期', data: null });
  }
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
    const { username, password } = req.body;

    // 1. Validate input
    if (!username || !password) {
      return res.json({ code: 40001, message: '用户名和密码不能为空', data: null });
    }

    if (!identifier) {
      return res.json({ code: 40001, message: '缺少比赛标识', data: null });
    }

    const prisma = getPrisma();

    try {
      // 2. Find the competition by UUID or access_code
      // const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
      const competition = await prisma.competitions.findFirst({
        where: { id: identifier },
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
