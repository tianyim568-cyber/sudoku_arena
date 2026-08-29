/**
 * admin routes — interface Super Admin pour la gestion de la plateforme.
 *
 * Ce routeur expose les endpoints de supervision et gestion pour le Super Admin:
 *   - GET /overview — statistiques globales (orgs, compétitions, utilisateurs)
 *   - GET /organizations/:id — détails d'une organisation avec ses utilisateurs
 *   - GET /users — liste filtrable de tous les utilisateurs
 *   - PATCH /organizations/:id — activer/désactiver une organisation
 *   - PATCH /users/:id — changer le rôle ou le statut d'un utilisateur
 *   - POST /users/:id/reset-password — réinitialiser le mot de passe
 *
 * Auth: Bearer token + SUPER_ADMIN role uniquement. ORG_ADMIN et autres rôles
 * n'ont pas accès à ces endpoints.
 *
 * Route mounting:
 *   app.use('/api/admin', createAdminRouter());
 */

const express = require('express');
const bcrypt = require('bcrypt');
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

  /**
   * GET /organizations/:id — detail of a single organization.
   *
   * Returns the org record plus its users (with role) and competitions
   * (with status), so the Super Admin can drill into any tenant from the
   * overview list without a second request.
   *
   * Response:
   *   200 { code: 200, data: { org, users, competitions } }
   *   404 { code: 40401 } — org not found
   *   500 { code: 50000 } — query failed
   */
  router.get('/organizations/:id', async (req, res) => {
    try {
      const prisma = getPrisma();
      const org = await prisma.organizations.findUnique({
        where: { id: req.params.id },
        include: {
          users: {
            select: { id: true, username: true, role: true, status: true, created_at: true },
            orderBy: { created_at: 'desc' },
          },
          competitions: {
            select: { id: true, name: true, status: true, created_at: true },
            orderBy: { created_at: 'desc' },
          },
        },
      });
      if (!org) {
        return res.json({ code: 40401, message: '组织不存在', data: null });
      }
      res.json({
        code: 200,
        message: 'success',
        data: {
          org: {
            id: org.id,
            name: org.name,
            status: org.status,
            createdAt: org.created_at,
          },
          users: org.users.map(u => ({
            id: u.id,
            username: u.username,
            role: u.role,
            status: u.status,
            createdAt: u.created_at,
          })),
          competitions: org.competitions.map(c => ({
            id: c.id,
            name: c.name,
            status: c.status,
            createdAt: c.created_at,
          })),
        },
      });
    } catch (e) {
      logger.error('Admin org detail failed', { error: e.message });
      res.json({ code: 50000, message: '无法加载组织详情', data: null });
    }
  });

  /**
   * GET /users — platform-wide user list, filterable by role and org.
   *
   * Query params:
   *   role  — filter by role (SUPER_ADMIN, ORG_ADMIN, JUDGE, PLAYER)
   *   orgId — filter by organization_id (uuid)
   *   q     — search by username (case-insensitive contains)
   *
   * Response:
   *   200 { code: 200, data: { users: [...] } }
   *   500 { code: 50000 } — query failed
   */
  router.get('/users', async (req, res) => {
    try {
      const prisma = getPrisma();
      const { role, orgId, q } = req.query;

      const where = {};
      if (role) where.role = role;
      if (orgId) where.organization_id = orgId;
      if (q) where.username = { contains: q, mode: 'insensitive' };

      const users = await prisma.users.findMany({
        where,
        select: {
          id: true,
          username: true,
          role: true,
          status: true,
          created_at: true,
          organization_id: true,
          organizations: { select: { name: true } },
        },
        orderBy: { created_at: 'desc' },
        take: 200,
      });

      res.json({
        code: 200,
        message: 'success',
        data: {
          users: users.map(u => ({
            id: u.id,
            username: u.username,
            role: u.role,
            status: u.status,
            createdAt: u.created_at,
            organizationId: u.organization_id,
            organizationName: u.organizations?.name || null,
          })),
        },
      });
    } catch (e) {
      logger.error('Admin users list failed', { error: e.message });
      res.json({ code: 50000, message: '无法加载用户列表', data: null });
    }
  });

  /**
   * PATCH /organizations/:id — toggle organization status (ACTIVE ↔ DISABLED).
   *
   * Body:
   *   { status: 'ACTIVE' | 'DISABLED' }
   *
   * Response:
   *   200 { code: 200, data: { org } }
   *   404 { code: 40401 } — org not found
   *   400 { code: 40001 } — invalid status
   *   500 { code: 50000 } — update failed
   */
  router.patch('/organizations/:id', async (req, res) => {
    try {
      const prisma = getPrisma();
      const { status } = req.body;

      if (!status || !['ACTIVE', 'DISABLED'].includes(status)) {
        return res.json({ code: 40001, message: '状态无效', data: null });
      }

      const org = await prisma.organizations.update({
        where: { id: req.params.id },
        data: { status, updated_at: new Date() },
      });

      res.json({
        code: 200,
        message: 'success',
        data: {
          org: {
            id: org.id,
            name: org.name,
            status: org.status,
            createdAt: org.created_at,
          },
        },
      });
    } catch (e) {
      if (e.code === 'P2025') {
        return res.json({ code: 40401, message: '组织不存在', data: null });
      }
      logger.error('Admin org toggle failed', { error: e.message });
      res.json({ code: 50000, message: '无法更新组织状态', data: null });
    }
  });

  /**
   * PATCH /users/:id — update user role or status.
   *
   * Body:
   *   { role?: 'SUPER_ADMIN' | 'ORG_ADMIN' | 'JUDGE' | 'PLAYER',
   *     status?: 'ACTIVE' | 'DISABLED' }
   *
   * Response:
   *   200 { code: 200, data: { user } }
   *   404 { code: 40401 } — user not found
   *   400 { code: 40001 } — invalid role or status
   *   500 { code: 50000 } — update failed
   */
  router.patch('/users/:id', async (req, res) => {
    try {
      const prisma = getPrisma();
      const { role, status } = req.body;

      const data = { updated_at: new Date() };
      if (role) {
        const validRoles = ['SUPER_ADMIN', 'ORG_ADMIN', 'JUDGE', 'PLAYER'];
        if (!validRoles.includes(role)) {
          return res.json({ code: 40001, message: '角色无效', data: null });
        }
        data.role = role;
      }
      if (status) {
        if (!['ACTIVE', 'DISABLED'].includes(status)) {
          return res.json({ code: 40001, message: '状态无效', data: null });
        }
        data.status = status;
      }

      const user = await prisma.users.update({
        where: { id: req.params.id },
        data,
      });

      res.json({
        code: 200,
        message: 'success',
        data: {
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            status: user.status,
          },
        },
      });
    } catch (e) {
      if (e.code === 'P2025') {
        return res.json({ code: 40401, message: '用户不存在', data: null });
      }
      logger.error('Admin user update failed', { error: e.message });
      res.json({ code: 50000, message: '无法更新用户', data: null });
    }
  });

  /**
   * POST /users/:id/reset-password — generate and set a new random password.
   *
   * Generates a 12-character random password, hashes it, and updates the user.
   * Returns the plain password so the admin can share it with the user.
   *
   * Response:
   *   200 { code: 200, data: { password } }
   *   404 { code: 40401 } — user not found
   *   500 { code: 50000 } — reset failed
   */
  router.post('/users/:id/reset-password', async (req, res) => {
    try {
      const prisma = getPrisma();

      // Generate 12-char random password
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
      let password = '';
      for (let i = 0; i < 12; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.users.update({
        where: { id: req.params.id },
        data: { password_hash: passwordHash, updated_at: new Date() },
      });

      res.json({
        code: 200,
        message: 'success',
        data: { password },
      });
    } catch (e) {
      if (e.code === 'P2025') {
        return res.json({ code: 40401, message: '用户不存在', data: null });
      }
      logger.error('Admin password reset failed', { error: e.message });
      res.json({ code: 50000, message: '无法重置密码', data: null });
    }
  });

  return router;
}

module.exports = { createAdminRouter };
