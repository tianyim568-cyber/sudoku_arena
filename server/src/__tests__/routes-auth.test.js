// Unit tests for the auth routes (POST /api/auth/login, GET /api/auth/me).
// We mount the auth router on a tiny Express app with MOCKED repos so the
// tests don't need a real PostgreSQL connection — fast and deterministic.
//
// What we verify:
//   - POST /api/auth/login with valid credentials -> 200 + token + user
//   - POST /api/auth/login with wrong password -> error envelope (code 40001)
//   - POST /api/auth/login with unknown user -> error envelope (code 40001)
//   - POST /api/auth/login with missing fields -> validation error (code 40001)
//   - GET /api/auth/me without token -> 401 (auth middleware rejects)

const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { createAuthRouter } = require('../routes/auth');

// Build a hashed password once so the mock user looks like a real DB row.
// Matches what _seedUsers would store for the 'admin' demo account.
const ADMIN_HASH = bcrypt.hashSync('admin123', 10);

// Mock repos factory — only the methods the auth router touches.
// Each test gets a fresh mock so call counters reset.
function buildRepos(overrides = {}) {
  return {
    users: {
      // Default: an admin user exists. Tests can override to return null
      // (user not found) or a different row.
      findByUsername: overrides.findByUsername || (async (username) => {
        if (username === 'admin') {
          return { id: 1, username: 'admin', password_hash: ADMIN_HASH, role: 'ADMIN', display_name: '管理员' };
        }
        return null;
      }),
      findById: overrides.findById || (async (id) => {
        if (id === 1) {
          return { id: 1, username: 'admin', role: 'ADMIN', display_name: '管理员' };
        }
        return null;
      }),
    },
  };
}

// Mount only the auth router — we don't need the full app (no Socket.IO,
// no puzzle bank, no DB). This is what makes the test fast and isolated.
function buildApp(repos) {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(repos));
  return app;
}

describe('POST /api/auth/login', () => {
  test('valid credentials return 200 + token + user object', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.username).toBe('admin');
    expect(res.body.data.user.role).toBe('ADMIN');
    // Password must NEVER be in the response.
    expect(res.body.data.user.password_hash).toBeUndefined();
  });

  test('wrong password returns error envelope with code 40001', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong-pw' });
    expect(res.status).toBe(200); // app uses HTTP 200 + code envelope, not HTTP 4xx
    expect(res.body.code).toBe(40001);
    expect(res.body.data).toBeNull();
    expect(res.body.token).toBeUndefined();
  });

  test('unknown user returns error envelope with code 40001', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).post('/api/auth/login').send({ username: 'ghost', password: 'whatever' });
    expect(res.body.code).toBe(40001);
    expect(res.body.data).toBeNull();
  });

  test('missing username is rejected by Zod validation (code 40001)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).post('/api/auth/login').send({ password: 'admin123' });
    expect(res.body.code).toBe(40001);
    expect(res.body.data).toBeNull();
  });

  test('empty body is rejected by Zod validation (code 40001)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.body.code).toBe(40001);
  });

  test('repos.users.findByUsername is actually called with the submitted username', async () => {
    let receivedUsername = null;
    const repos = buildRepos({
      findByUsername: async (username) => {
        receivedUsername = username;
        return { id: 1, username, password_hash: ADMIN_HASH, role: 'ADMIN', display_name: 'x' };
      },
    });
    const app = buildApp(repos);
    await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
    expect(receivedUsername).toBe('admin');
  });
});

describe('GET /api/auth/me', () => {
  test('without an Authorization header returns 401 (authMiddleware rejects)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('with a malformed Authorization header returns 401', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).get('/api/auth/me').set('Authorization', 'NotBearer');
    expect(res.status).toBe(401);
  });

  test('with a garbage token returns 401', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage.token.here');
    expect(res.status).toBe(401);
  });
});
