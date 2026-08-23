// Unit tests for the access-link routes.
//
// routes/competitions.js exposes four routes that together manage the entry
// link a competition hands to its players:
//
//   POST   /:id/access-link          — mint a new code (PUBLISHED only)
//   GET    /:id/access-link          — read the current code (or null)
//   DELETE /:id/access-link          — revoke the code
//   GET    /by-code/:accessCode/info  — public landing-page data (no auth)
//
// These routes are tested E2E by server/test-access-links.js against a live
// database. The tests here run in Jest without any server or database: we mock
// Prisma with an in-memory object so each test can shape the competition state
// precisely. The tenantGuard is mocked the same way routes-publish.test.js
// already does — it reads organizationId from the JWT and calls next().
//
// The rule Louise insisted on is covered twice here:
//   "Publier active le bouton générer; publier ne génère pas le lien."
// A DRAFT competition must refuse POST /access-link (code 40041). This is the
// server-side gate that backs the disabled button — a direct call cannot
// bypass it.

const express = require('express');
const request = require('supertest');
const { generateToken } = require('../middleware/auth');

// Mock tenantGuard — same shape as routes-competitions.test.js. The real
// tenantGuard is exercised E2E; here we only need it to set organizationId
// and call next() so the route handler runs.
jest.mock('../middleware/tenantGuard', () => {
  const { tenantGuard } = jest.requireActual('../middleware/tenantGuard');
  function mockTenantGuard(resource, options) {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ code: 40101, message: '未登录', data: null });
      }
      const { role, organizationId } = req.user;
      if (role === 'SUPER_ADMIN') {
        req.organizationId = organizationId || null;
        return next();
      }
      if (!organizationId) {
        return res.status(403).json({
          code: 40301,
          message: '用户未关联任何组织，无法访问',
          data: null,
        });
      }
      req.organizationId = organizationId;
      return next();
    };
  }
  return { tenantGuard: mockTenantGuard, __real: tenantGuard };
});

// Mock competitionAuth — the router imports it at module load, but the
// access-link routes do not use it.
jest.mock('../middleware/competitionAuth', () => ({
  competitionLogin: () => (req, res) => res.json({ code: 200, message: 'stub', data: null }),
}));

// Prisma mock. Each test installs its own implementation via setPrismaMock().
// The default is a PUBLISHED competition with no existing code — the happy
// path for POST /access-link.
//
// Jest requires mock factory variables to be prefixed with `mock` so the
// hoisting does not reference an uninitialized variable. The accessor
// below closes over the variable lazily, which is the supported pattern.
let mockPrisma = null;
function setPrismaMock(impl) { mockPrisma = impl; }
function mockDefaultPrisma() {
  return {
    competitions: {
      // findUnique is called with { where: { id } } for the competition
      // lookup AND with { where: { competition_access_code } } for the
      // collision check during POST. We distinguish by key.
      findUnique: async ({ where }) => {
        if (where.competition_access_code) {
          // No collision on the generated code — always return null.
          return null;
        }
        return {
          id: where.id,
          name: 'Spring Cup',
          status: 'PUBLISHED',
          organization_id: 'org-admin',
          competition_access_code: null,
        };
      },
      update: async ({ where: { id }, data }) => ({ id, ...data }),
    },
  };
}
jest.mock('../db/prisma', () => ({
  getPrisma: () => mockPrisma || mockDefaultPrisma(),
}));

const { createCompetitionRouter } = require('../routes/competitions');

// Real JWT tokens minted with the same helper the production app uses.
const ADMIN_TOKEN = generateToken({ id: 1, username: 'admin', role: 'ORG_ADMIN', organization_id: 'org-admin' });
const JUDGE_TOKEN = generateToken({ id: 2, username: 'judge', role: 'JUDGE', organization_id: 'org-admin' });
const PLAYER_TOKEN = generateToken({ id: 3, username: 'player1', role: 'PLAYER', organization_id: 'org-admin' });

function buildApp() {
  const app = express();
  app.use(express.json());
  // Empty repos — access-link routes read via getPrisma directly, not via
  // injected repos.
  app.use('/api/competitions', createCompetitionRouter({}));
  return app;
}

beforeEach(() => { mockPrisma = mockDefaultPrisma(); });

describe('POST /api/competitions/:id/access-link', () => {
  test('a PUBLISHED competition gets a new code and entryUrl', async () => {
    const res = await request(buildApp())
      .post('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.accessCode).toBeTruthy();
    // Access codes are short alphanumeric strings — not UUIDs, not long
    // hashes. 8 chars is the current length; we assert >= 6 so the test
    // does not break if the length is tuned.
    expect(res.body.data.accessCode.length).toBeGreaterThanOrEqual(6);
    expect(res.body.data.entryUrl).toContain(res.body.data.accessCode);
  });

  test('the generated code is written to the database', async () => {
    const updates = [];
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where }) => {
          if (where.competition_access_code) return null;
          return { id: where.id, status: 'PUBLISHED', competition_access_code: null };
        },
        update: async ({ where, data }) => { updates.push({ where, data }); return { id: where.id, ...data }; },
      },
    });
    const res = await request(buildApp())
      .post('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.competition_access_code).toBe(res.body.data.accessCode);
  });

  test('regenerating replaces the old code with a different one', async () => {
    // Louise's rule: "regenerate makes the previous link unusable." The
    // old code must be overwritten, not left coexisting with the new one.
    const updates = [];
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where }) => {
          if (where.competition_access_code) return null;
          return {
            id: where.id,
            status: 'PUBLISHED',
            competition_access_code: 'OLD-CODE-1',
          };
        },
        update: async ({ where, data }) => { updates.push({ where, data }); return { id: where.id, ...data }; },
      },
    });
    const res = await request(buildApp())
      .post('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(200);
    expect(res.body.data.accessCode).not.toBe('OLD-CODE-1');
    expect(updates[0].data.competition_access_code).toBe(res.body.data.accessCode);
  });

  // Louise's rule: "Publier active le bouton; publier ne génère pas le lien."
  // A DRAFT competition must refuse. This is the server-side gate — a direct
  // call cannot bypass the disabled button.
  test('a DRAFT competition is refused with code 40041', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where }) => ({ id: where.id, status: 'DRAFT', competition_access_code: null }),
        update: async () => { throw new Error('must not write'); },
      },
    });
    const res = await request(buildApp())
      .post('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40041);
    expect(res.body.data).toBeNull();
  });

  test('unknown competition id → 40400', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: { findUnique: async () => null, update: async () => ({}) },
    });
    const res = await request(buildApp())
      .post('/api/competitions/unknown/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40400);
  });

  test('JUDGE is forbidden (403)', async () => {
    const res = await request(buildApp())
      .post('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('PLAYER is forbidden (403)', async () => {
    const res = await request(buildApp())
      .post('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('unauthenticated → 401', async () => {
    const res = await request(buildApp())
      .post('/api/competitions/c1/access-link');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/competitions/:id/access-link', () => {
  test('returns the existing accessCode and entryUrl', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where }) => ({
          id: where.id,
          name: 'Spring Cup',
          competition_access_code: 'ABC12345',
        }),
        update: async () => ({}),
      },
    });
    const res = await request(buildApp())
      .get('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.accessCode).toBe('ABC12345');
    expect(res.body.data.entryUrl).toContain('ABC12345');
  });

  test('returns null accessCode and null entryUrl when no link exists', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where }) => ({
          id: where.id,
          name: 'Spring Cup',
          competition_access_code: null,
        }),
        update: async () => ({}),
      },
    });
    const res = await request(buildApp())
      .get('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(200);
    expect(res.body.data.accessCode).toBeNull();
    expect(res.body.data.entryUrl).toBeNull();
  });

  test('unknown competition id → 40400', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: { findUnique: async () => null, update: async () => ({}) },
    });
    const res = await request(buildApp())
      .get('/api/competitions/unknown/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40400);
  });

  test('JUDGE is forbidden (403)', async () => {
    const res = await request(buildApp())
      .get('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`);
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/competitions/:id/access-link', () => {
  test('clears the access_code in the database', async () => {
    const updates = [];
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where }) => ({
          id: where.id,
          status: 'PUBLISHED',
          competition_access_code: 'CODE-TO-REVOKE',
        }),
        update: async ({ where, data }) => { updates.push({ where, data }); return { id: where.id, ...data }; },
      },
    });
    const res = await request(buildApp())
      .delete('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].data.competition_access_code).toBeNull();
  });

  test('unknown competition id → 40400', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: { findUnique: async () => null, update: async () => ({}) },
    });
    const res = await request(buildApp())
      .delete('/api/competitions/unknown/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40400);
  });

  test('JUDGE is forbidden (403)', async () => {
    const res = await request(buildApp())
      .delete('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/competitions/by-code/:accessCode/info', () => {
  // This is the public landing-page endpoint — no auth required. The frontend
  // entry page (/competition/:accessCode) calls it to show the competition
  // name and status before the user logs in.
  test('returns competition id, name, status, and organization name', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where }) => ({
          id: 'c1',
          name: 'Spring Cup',
          status: 'PUBLISHED',
          organizations: { name: 'Acme Ltd.' },
        }),
        update: async () => ({}),
      },
    });
    const res = await request(buildApp())
      .get('/api/competitions/by-code/ABC12345/info');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.id).toBe('c1');
    expect(res.body.data.name).toBe('Spring Cup');
    expect(res.body.data.status).toBe('PUBLISHED');
    expect(res.body.data.organizationName).toBe('Acme Ltd.');
  });

  test('an unknown access code → 40400 (no auth needed to learn this)', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: { findUnique: async () => null, update: async () => ({}) },
    });
    const res = await request(buildApp())
      .get('/api/competitions/by-code/UNKNOWN-CODE/info');
    expect(res.body.code).toBe(40400);
  });

  test('no Authorization header required — this is the landing page', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async () => ({
          id: 'c1', name: 'Spring Cup', status: 'PUBLISHED',
          organizations: { name: 'Acme' },
        }),
        update: async () => ({}),
      },
    });
    const res = await request(buildApp())
      .get('/api/competitions/by-code/ABC12345/info');
    // The route has no authMiddleware — a player arriving with the link
    // must see the competition info without having logged in.
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
  });
});
