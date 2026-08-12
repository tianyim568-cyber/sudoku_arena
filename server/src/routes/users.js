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
    const existing = await repos.users.findByUsernameSafe(username);
    if (existing) {
      return res.json({ code: 40003, message: '用户名已存在', data: null });
    }
    const hash = bcrypt.hashSync(password, 10);
    const user = await repos.users.create({ username, password: hash, role, organizationId });
    res.json({ code: 200, message: 'success', data: user });
  });

  router.get('/', async (req, res) => {
    const users = await repos.users.findAll();
    res.json({ code: 200, message: 'success', data: users });
  });

  router.put('/:id/status', validateBody(updateStatusSchema), async (req, res) => {
    const { status } = req.body;
    await repos.users.updateStatus(req.params.id, status);
    res.json({ code: 200, message: 'success', data: null });
  });

  return router;
}

module.exports = { createUserRouter };
