const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { generateToken, authMiddleware } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { loginSchema } = require('../validations/auth');

function createAuthRouter(repos) {
  const router = express.Router();

  // Rate limit login attempts: 30 requests per 15 minutes per IP
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { code: 429, message: '登录尝试过于频繁，请15分钟后再试', data: null },
    standardHeaders: true,
    legacyHeaders: false
  });

  router.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
    const { username, password } = req.body;
    const user = await repos.users.findByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.json({ code: 40001, message: '用户名或密码错误', data: null });
    }
    const token = generateToken(user);
    res.json({
      code: 200, message: 'success', data: {
        token,
        user: { id: user.id, username: user.username, role: user.role, displayName: user.display_name }
      }
    });
  });

  router.get('/me', authMiddleware, async (req, res) => {
    const user = await repos.users.findById(req.user.userId);
    if (!user) {
      return res.json({ code: 40004, message: '用户不存在', data: null });
    }
    res.json({
      code: 200, message: 'success', data: {
        id: user.id, username: user.username, role: user.role, displayName: user.display_name
      }
    });
  });

  return router;
}

module.exports = { createAuthRouter };
