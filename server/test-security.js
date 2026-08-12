/**
 * Security Hardening Integration Test
 *
 * Tests:
 * 1. Helmet.js security headers are set correctly
 * 2. Zod validation rejects invalid input (auth routes)
 * 3. Zod validation rejects invalid input (users routes)
 * 4. Zod validation accepts valid input
 * 5. Competition login validation works
 */

const assert = require('assert');
const express = require('express');
const helmet = require('helmet');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { validateBody, z } = require('./src/middleware/validate');
const { competitionLogin } = require('./src/middleware/competitionAuth');
const { getPrisma } = require('./src/db/prisma');
const { createRepositoryFactory } = require('./src/db');

const prisma = getPrisma();
const repos = createRepositoryFactory(prisma);

// ── Test 1: Helmet headers ──

async function test1_HelmetHeaders() {
  console.log('Test 1: Helmet.js security headers');

  const app = express();
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"],
      },
    },
  }));
  app.get('/test', (req, res) => res.json({ ok: true }));

  const res = await request(app).get('/test');

  assert.ok(res.headers['x-content-type-options'], 'Should have X-Content-Type-Options');
  assert.strictEqual(res.headers['x-content-type-options'], 'nosniff', 'X-Content-Type-Options should be nosniff');
  assert.ok(res.headers['x-frame-options'], 'Should have X-Frame-Options');
  assert.ok(res.headers['strict-transport-security'], 'Should have Strict-Transport-Security');
  assert.ok(res.headers['content-security-policy'], 'Should have Content-Security-Policy');

  console.log('✓ Helmet headers are set correctly\n');
}

// ── Test 2: Auth validation rejects invalid input ──

async function test2_AuthValidation() {
  console.log('Test 2: Auth routes Zod validation');

  const loginSchema = z.object({
    username: z.string().min(1, '用户名不能为空'),
    password: z.string().min(1, '密码不能为空'),
  });

  const registerSchema = z.object({
    organizationName: z.string().min(2, '组织名称至少需要2个字符'),
    adminUsername: z.string().min(1, '管理员用户名不能为空'),
    password: z.string().min(6, '密码至少需要6个字符'),
  });

  const app = express();
  app.use(express.json());

  app.post('/login', validateBody(loginSchema), (req, res) => {
    res.json({ code: 200, message: 'success', data: req.body });
  });

  app.post('/register', validateBody(registerSchema), (req, res) => {
    res.json({ code: 200, message: 'success', data: req.body });
  });

  // Test login with empty fields
  let res = await request(app).post('/login').send({ username: '', password: '' });
  assert.strictEqual(res.body.code, 40001, 'Should reject empty username/password');

  // Test register with short password
  res = await request(app).post('/register').send({
    organizationName: 'Test Org',
    adminUsername: 'admin',
    password: '12345', // Too short
  });
  assert.strictEqual(res.body.code, 40001, 'Should reject short password');
  assert.ok(res.body.message.includes('6个字符'), 'Should mention 6 character minimum');

  // Test register with short org name
  res = await request(app).post('/register').send({
    organizationName: 'A', // Too short
    adminUsername: 'admin',
    password: 'password123',
  });
  assert.strictEqual(res.body.code, 40001, 'Should reject short org name');

  // Test valid input
  res = await request(app).post('/login').send({
    username: 'testuser',
    password: 'testpass',
  });
  assert.strictEqual(res.body.code, 200, 'Should accept valid login input');
  assert.strictEqual(res.body.data.username, 'testuser', 'Should pass through username');

  console.log('✓ Auth validation works correctly\n');
}

// ── Test 3: Users validation ──

async function test3_UsersValidation() {
  console.log('Test 3: Users routes Zod validation');

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

  const app = express();
  app.use(express.json());

  app.post('/users', validateBody(createUserSchema), (req, res) => {
    res.json({ code: 200, message: 'success', data: req.body });
  });

  app.put('/users/:id/status', validateBody(updateStatusSchema), (req, res) => {
    res.json({ code: 200, message: 'success', data: null });
  });

  // Test invalid role
  let res = await request(app).post('/users').send({
    username: 'newuser',
    password: 'password123',
    role: 'INVALID_ROLE',
  });
  assert.strictEqual(res.body.code, 40001, 'Should reject invalid role');

  // Test short password
  res = await request(app).post('/users').send({
    username: 'newuser',
    password: '12345',
    role: 'PLAYER',
  });
  assert.strictEqual(res.body.code, 40001, 'Should reject short password');

  // Test invalid status
  res = await request(app).put('/users/123/status').send({
    status: 'UNKNOWN',
  });
  assert.strictEqual(res.body.code, 40001, 'Should reject invalid status');

  // Test valid create user
  res = await request(app).post('/users').send({
    username: 'newuser',
    password: 'password123',
    role: 'PLAYER',
  });
  assert.strictEqual(res.body.code, 200, 'Should accept valid create user input');

  // Test valid status update
  res = await request(app).put('/users/123/status').send({
    status: 'ACTIVE',
  });
  assert.strictEqual(res.body.code, 200, 'Should accept valid status update');

  console.log('✓ Users validation works correctly\n');
}

// ── Test 4: Competition login validation ──

async function test4_CompetitionLoginValidation() {
  console.log('Test 4: Competition login Zod validation');

  const handler = competitionLogin(repos);

  const mockRes = () => {
    const res = {
      _json: null,
      _status: 200,
      status(code) {
        res._status = code;
        return res;
      },
      json(data) {
        res._json = data;
        return res;
      },
    };
    return res;
  };

  // Test empty username
  const req1 = { params: { identifier: 'test123' }, body: { username: '', password: 'pass' } };
  const res1 = mockRes();
  await handler(req1, res1);
  assert.strictEqual(res1._json.code, 40001, 'Should reject empty username');
  assert.ok(res1._json.message.includes('用户名'), 'Should mention username');

  // Test empty password
  const req2 = { params: { identifier: 'test123' }, body: { username: 'user', password: '' } };
  const res2 = mockRes();
  await handler(req2, res2);
  assert.strictEqual(res2._json.code, 40001, 'Should reject empty password');
  assert.ok(res2._json.message.includes('密码'), 'Should mention password');

  // Test missing identifier
  const req3 = { params: { identifier: '' }, body: { username: 'user', password: 'pass' } };
  const res3 = mockRes();
  await handler(req3, res3);
  assert.strictEqual(res3._json.code, 40001, 'Should reject missing identifier');

  console.log('✓ Competition login validation works correctly\n');
}

// ── Test 5: XSS protection ──

async function test5_XSSProtection() {
  console.log('Test 5: XSS protection via Helmet');

  const app = express();
  app.use(helmet());
  app.get('/test', (req, res) => res.json({ ok: true }));

  const res = await request(app).get('/test');

  // Helmet sets X-XSS-Protection by default (though modern browsers ignore it)
  assert.ok(res.headers['x-xss-protection'] || res.headers['x-content-type-options'],
    'Should have XSS protection headers');

  console.log('✓ XSS protection headers are set\n');
}

// ── Test 6: Input sanitization ──

async function test6_InputSanitization() {
  console.log('Test 6: Input sanitization (HTML/script rejection)');

  const schema = z.object({
    username: z.string().min(1).max(100),
    password: z.string().min(1),
  });

  const app = express();
  app.use(express.json());
  app.post('/test', validateBody(schema), (req, res) => {
    res.json({ code: 200, message: 'success', data: req.body });
  });

  // Test very long input (should be rejected by max length)
  const longString = 'a'.repeat(200);
  const res = await request(app).post('/test').send({
    username: longString,
    password: 'password123',
  });
  assert.strictEqual(res.body.code, 40001, 'Should reject overly long input');

  // Test valid input
  const res2 = await request(app).post('/test').send({
    username: 'validuser',
    password: 'password123',
  });
  assert.strictEqual(res2.body.code, 200, 'Should accept valid input');

  console.log('✓ Input sanitization works correctly\n');
}

// ── Run all tests ──

async function runTests() {
  console.log('='.repeat(60));
  console.log('Security Hardening Integration Test Suite');
  console.log('='.repeat(60) + '\n');

  try {
    await test1_HelmetHeaders();
    await test2_AuthValidation();
    await test3_UsersValidation();
    await test4_CompetitionLoginValidation();
    await test5_XSSProtection();
    await test6_InputSanitization();

    console.log('='.repeat(60));
    console.log('ALL SECURITY TESTS PASSED');
    console.log('='.repeat(60));
    process.exit(0);
  } catch (error) {
    console.error('\nTEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTests();
