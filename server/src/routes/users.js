const express = require('express');
const bcrypt = require('bcryptjs');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const { validateBody, z } = require('../middleware/validate');

function createUserRouter(repos) {
  const router = express.Router();

  // Zod schemas
  const createUserSchema = z.object({
    username: z.string().min(1, '用户名不能为空'),
    password: z.string().min(6, '密码至少需要6个字符'),
    role: z.enum(['SUPER_ADMIN', 'ORG_ADMIN', 'JUDGE', 'PLAYER'], {
      errorMap: () => ({ message: '角色值无效' }),
    }),
    organizationId: z.string().uuid().optional().nullable(),
  });

  const updateStatusSchema = z.object({
    status: z.enum(['ACTIVE', 'INACTIVE'], {
      errorMap: () => ({ message: '状态值无效' }),
    }),
  });

  router.use(authMiddleware, roleMiddleware('SUPER_ADMIN', 'ORG_ADMIN'));

  router.post('/', validateBody(createUserSchema), async (req, res) => {
    const { username, password, role, organizationId } = req.body;

    // SECURITY: ORG_ADMIN can only create users in their own organization
    if (req.user.role === 'ORG_ADMIN' && organizationId !== req.user.organizationId) {
      return res.json({ code: 40301, message: '无权在此组织下创建用户', data: null });
    }
    // SECURITY: If no organizationId provided and caller is ORG_ADMIN, auto-assign their org
    const effectiveOrgId = organizationId || (req.user.role === 'ORG_ADMIN' ? req.user.organizationId : null);

    const existing = await repos.users.findByUsernameSafe(username);
    if (existing) {
      return res.json({ code: 40003, message: '用户名已存在', data: null });
    }
    const hash = bcrypt.hashSync(password, 10);
    const user = await repos.users.create({ username, password: hash, role, organizationId: effectiveOrgId });
    res.json({ code: 200, message: 'success', data: user });
  });

  router.get('/', async (req, res) => {
    // SECURITY: ORG_ADMIN only sees users in their own organization
    const { getPrisma } = require('../db/prisma');
    const prisma = getPrisma();
    const where = req.user.role === 'ORG_ADMIN'
      ? { organization_id: req.user.organizationId }
      : {};
    const users = await prisma.users.findMany({
      where,
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
        organization_id: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
    res.json({ code: 200, message: 'success', data: users });
  });

  router.put('/:id/status', validateBody(updateStatusSchema), async (req, res) => {
    const { status } = req.body;

    // SECURITY: ORG_ADMIN can only modify users in their own organization
    if (req.user.role === 'ORG_ADMIN') {
      const { getPrisma } = require('../db/prisma');
      const prisma = getPrisma();
      const targetUser = await prisma.users.findUnique({
        where: { id: req.params.id },
        select: { organization_id: true },
      });
      if (!targetUser || targetUser.organization_id !== req.user.organizationId) {
        return res.json({ code: 40301, message: '无权操作此用户', data: null });
      }
    }

    await repos.users.updateStatus(req.params.id, status);
    res.json({ code: 200, message: 'success', data: null });
  });

  return router;
}

module.exports = { createUserRouter };
