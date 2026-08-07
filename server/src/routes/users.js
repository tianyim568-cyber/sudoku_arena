const express = require('express');
const bcrypt = require('bcryptjs');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

function createUserRouter(repos) {
  const router = express.Router();

  router.use(authMiddleware, roleMiddleware('SUPER_ADMIN', 'ORG_ADMIN'));

  router.post('/', async (req, res) => {
    const { username, password, role, organizationId } = req.body;
    if (!username || !password || !role) {
      return res.json({ code: 40003, message: '缺少必填字段', data: null });
    }
    if (!['SUPER_ADMIN', 'ORG_ADMIN', 'JUDGE', 'PLAYER'].includes(role)) {
      return res.json({ code: 40004, message: '角色值无效', data: null });
    }
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

  router.put('/:id/status', async (req, res) => {
    const { status } = req.body;
    if (!['ACTIVE', 'INACTIVE'].includes(status)) {
      return res.json({ code: 40004, message: '状态值无效', data: null });
    }
    await repos.users.updateStatus(req.params.id, status);
    res.json({ code: 200, message: 'success', data: null });
  });

  return router;
}

module.exports = { createUserRouter };
