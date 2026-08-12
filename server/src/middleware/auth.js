/**
 * auth.js — unified authentication middleware for org-scoped and competition-scoped JWTs.
 *
 * Two token types coexist:
 *
 *   Org-scoped (no `type` field):
 *     { userId, username, role, organizationId }
 *
 *   Competition-scoped (`type: 'competition'`):
 *     { type: 'competition', competitionId, userId, role,
 *       participantId, organizationId }
 *
 * authMiddleware handles BOTH types transparently:
 *   - `req.user` is always populated with { userId, username, role, organizationId }
 *   - For competition tokens, `req.competition` is also populated with
 *     { competitionId, userId, role, participantId, organizationId }
 *
 * This means existing code that reads `req.user.userId` or `req.user.role`
 * works unchanged regardless of which token type was used.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Generate an org-scoped JWT.
 * Used during org registration and org dashboard login.
 */
function generateToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username, role: user.role, organizationId: user.organization_id },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN }
  );
}

/**
 * Generate a competition-scoped JWT.
 * Used when a judge or player logs in via a competition entry link.
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

/**
 * Unified auth middleware — validates both org-scoped and competition-scoped JWTs.
 *
 * After this middleware runs:
 *   req.user = { userId, username, role, organizationId }
 *
 *   For competition tokens only:
 *     req.user.username = null (not in competition payload)
 *     req.competition = { competitionId, userId, role, participantId, organizationId }
 *
 *   For org tokens:
 *     req.competition = undefined (not set)
 *
 * Responses:
 *   401 { code: 40101 } — no Authorization header
 *   401 { code: 40102 } — token invalid or expired
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 40101, message: '未登录', data: null });
  }
  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);

    // Common fields — always present in both token types
    req.user = {
      userId: decoded.userId,
      username: decoded.username || null,
      role: decoded.role,
      organizationId: decoded.organizationId,
    };

    // Competition-scoped token: attach extra context
    if (decoded.type === 'competition') {
      req.competition = {
        competitionId: decoded.competitionId,
        userId: decoded.userId,
        role: decoded.role,
        participantId: decoded.participantId,
        organizationId: decoded.organizationId,
      };
    }

    next();
  } catch (e) {
    return res.status(401).json({ code: 40102, message: 'Token无效或已过期', data: null });
  }
}

/**
 * Role-based access control middleware.
 * Works with both token types since `req.user.role` is always populated.
 */
function roleMiddleware(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ code: 40101, message: '未登录', data: null });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ code: 40301, message: '权限不足', data: null });
    }
    next();
  };
}

module.exports = { generateToken, generateCompetitionToken, authMiddleware, roleMiddleware };
