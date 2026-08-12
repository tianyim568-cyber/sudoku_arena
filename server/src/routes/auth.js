const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { generateToken, authMiddleware } = require('../middleware/auth');
const { getPrisma } = require('../db/prisma');
const { validateBody, z } = require('../middleware/validate');

function createAuthRouter(repos) {
  const router = express.Router();

  // Zod schemas for validation
  const registerSchema = z.object({
    organizationName: z.string().min(2, '组织名称至少需要2个字符'),
    adminUsername: z.string().min(1, '管理员用户名不能为空'),
    password: z.string().min(6, '密码至少需要6个字符'),
  });

  const loginSchema = z.object({
    username: z.string().min(1, '用户名不能为空'),
    password: z.string().min(1, '密码不能为空'),
  });

  // Rate limit login attempts: 30 requests per 15 minutes per IP
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { code: 429, message: '登录尝试过于频繁，请15分钟后再试', data: null },
    standardHeaders: true,
    legacyHeaders: false
  });

  // Rate limit registration: 10 requests per 15 minutes per IP
  const registerLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { code: 429, message: '注册尝试过于频繁，请15分钟后再试', data: null },
    standardHeaders: true,
    legacyHeaders: false
  });

  /**
   * POST /register — Public registration for new organizations.
   * Creates an organization + its first ORG_ADMIN user atomically.
   */
  router.post('/register', registerLimiter, validateBody(registerSchema), async (req, res) => {
    const { organizationName, adminUsername, password } = req.body;

    const prisma = getPrisma();

    try {
      // 3. Check for duplicates
      const existingOrg = await repos.organizations.findByName(organizationName.trim());
      if (existingOrg) {
        return res.json({ code: 40003, message: '组织名称已存在', data: null });
      }

      const existingUser = await repos.users.findByUsernameSafe(adminUsername.trim());
      if (existingUser) {
        return res.json({ code: 40003, message: '用户名已存在', data: null });
      }

      // 4. Atomic transaction: create org + admin user
      const passwordHash = bcrypt.hashSync(password, 10);

      const [org, user] = await prisma.$transaction(async (tx) => {
        const newOrg = await tx.organizations.create({
          data: {
            name: organizationName.trim(),
            status: 'ACTIVE',
          },
        });

        const newUser = await tx.users.create({
          data: {
            organization_id: newOrg.id,
            username: adminUsername.trim(),
            password_hash: passwordHash,
            role: 'ORG_ADMIN',
            status: 'ACTIVE',
          },
        });

        return [newOrg, newUser];
      });

      // 5. Generate JWT token (auto-login after registration)
      const token = generateToken(user);

      res.status(201).json({
        code: 200,
        message: 'success',
        data: {
          token,
          organization: { id: org.id, name: org.name },
          user: { id: user.id, username: user.username, role: user.role, organizationId: user.organization_id },
        },
      });
    } catch (e) {
      // Handle unique constraint violation (race condition safety)
      if (e.code === 'P2002') {
        const field = e.meta?.target?.[0];
        if (field === 'username') {
          return res.json({ code: 40003, message: '用户名已存在', data: null });
        }
        return res.json({ code: 40003, message: '注册失败，请重试', data: null });
      }
      console.error('Registration error:', e.message);
      res.json({ code: 50000, message: '注册失败，请稍后重试', data: null });
    }
  });

  router.post('/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
    const { username, password } = req.body;
    const user = await repos.users.findByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.json({ code: 40001, message: '用户名或密码错误', data: null });
    }
    const token = generateToken(user);
    res.json({
      code: 200, message: 'success', data: {
        token,
        user: { id: user.id, username: user.username, role: user.role, organizationId: user.organization_id }
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
        id: user.id, username: user.username, role: user.role, organizationId: user.organization_id
      }
    });
  });

  return router;
}

module.exports = { createAuthRouter };
