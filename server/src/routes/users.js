const express = require('express');
const bcrypt = require('bcryptjs');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

function createUserRouter(repos) {
  const router = express.Router();

  router.use(authMiddleware, roleMiddleware('ADMIN'));

  router.post('/', async (req, res) => {
    const { username, password, role, displayName } = req.body;
    if (!username || !password || !role) {
      return res.json({ code: 40003, message: '缺少必填字段', data: null });
    }
    if (!['ADMIN', 'JUDGE', 'PLAYER'].includes(role)) {
      return res.json({ code: 40004, message: '角色值无效', data: null });
    }
    const existing = await repos.users.findByUsernameSafe(username);
    if (existing) {
      return res.json({ code: 40003, message: '用户名已存在', data: null });
    }
    const hash = bcrypt.hashSync(password, 10);
    const user = await repos.users.create({ username, password: hash, role, displayName: displayName || username });
    res.json({ code: 200, message: 'success', data: user });
  });

  router.get('/', async (req, res) => {
    const users = await repos.users.findAll();
    res.json({ code: 200, message: 'success', data: users });
  });

  return router;
}

module.exports = { createUserRouter };
