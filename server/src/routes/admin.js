/**
 * admin routes — platform-wide read-only overview for Super Admin.
 *
 * The Super Admin owns the platform but, until R11, landed on a waiting page
 * with no information. This router exposes a single overview endpoint that
 * aggregates platform stats (counts of organizations, competitions by status,
 * users by role) plus the org list and the competition list — read-only.
 *
 * No create/update/delete here. P2 scope is read-only — platform mutation
 * (create org, disable org, reset password) is a later phase and would step
 * on sensitive ground (cross-tenant impact) that needs Sylvain's review.
 *
 * Auth: Bearer token + SUPER_ADMIN role only. Not ORG_ADMIN — an org admin
 * has no business seeing the platform-wide view.
 *
 * Route mounting:
 *   app.use('/api/admin', createAdminRouter());
 */

const express = require('express');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { getPrisma } = require('../db/prisma');
const logger = require('../utils/logger');

function createAdminRouter() {
  const router = express.Router();

  // Every route in this router is SUPER_ADMIN-only. The guard on the router
  // (rather than per-route) makes a new route added later automatically
  // inherit the gate — there is no way to forget it.
  router.use(authMiddleware, roleMiddleware('SUPER_ADMIN'));

  /**
   * GET /overview — Platform-wide overview for the Super Admin.
   *
   * Returns:
   *   - stats: { organizations, competitions: { total, byStatus }, users: { byRole } }
   *   - organizations: [{ id, name, status, createdAt, userCount, competitionCount }]
   *   - competitions: [{ id, name, status, organizationName, createdAt }]
   *
   * All counts are computed in a single set of Prisma queries — the platform
   * is small enough (dozens of orgs, hundreds of competitions at most) that
   * we do not need caching yet.
   *
   * Response:
   *   200 { code: 200, data: { stats, organizations, competitions } }
   *   500 { code: 50000 } — aggregation failed
   */
  router.get('/overview', async (req, res) => {
    try {
      const prisma = getPrisma();

      // Counts — parallel queries. Each is a scalar, so the cost is one row
      // per query. groupBy is used for by-status / by-role breakdowns so the
      // client does not have to re-count the full lists.
      const [
        orgCount,
        competitionCount,
        competitionsByStatus,
        usersByRole,
        organizations,
        competitions,
      ] = await Promise.all([
        prisma.organizations.count(),
        prisma.competitions.count(),
        prisma.competitions.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        prisma.users.groupBy({
          by: ['role'],
          _count: { _all: true },
        }),
        // Orgs with user count + competition count (via _count).
        prisma.organizations.findMany({
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            name: true,
            status: true,
            created_at: true,
            _count: {
              select: { users: true, competitions: true },
            },
          },
        }),
        // Competitions with their org name — newest first, capped at 50 to
        // keep the payload reasonable (the page shows a recent list, not the
        // full history).
        prisma.competitions.findMany({
          orderBy: { created_at: 'desc' },
          take: 50,
          select: {
            id: true,
            name: true,
            status: true,
            created_at: true,
            organizations: { select: { name: true } },
          },
        }),
      ]);

      // Reshape groupBy results into a { STATUS: count } map — easier for
      // the client to read than [{ status, _count: { _all } }, ...].
      const byStatus = {};
      for (const g of competitionsByStatus) {
        byStatus[g.status] = g._count._all;
      }
      const byRole = {};
      for (const g of usersByRole) {
        byRole[g.role] = g._count._all;
      }

      res.json({
        code: 200,
        message: 'success',
        data: {
          stats: {
            organizations: orgCount,
            competitions: {
              total: competitionCount,
              byStatus,
            },
            users: {
              byRole,
            },
          },
          organizations: organizations.map(o => ({
            id: o.id,
            name: o.name,
            status: o.status,
            createdAt: o.created_at,
            userCount: o._count.users,
            competitionCount: o._count.competitions,
          })),
          competitions: competitions.map(c => ({
            id: c.id,
            name: c.name,
            status: c.status,
            createdAt: c.created_at,
            organizationName: c.organizations?.name || null,
          })),
        },
      });
    } catch (e) {
      logger.error('Admin overview failed', { error: e.message });
      res.json({ code: 50000, message: '无法加载平台概览', data: null });
    }
  });

  return router;
}

module.exports = { createAdminRouter };
