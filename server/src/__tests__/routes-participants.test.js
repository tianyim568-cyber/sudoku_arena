// Unit tests for the participant router (Phase 9 — reactivated).
//
// The router was commented out in index.js since migration 018. Phase 9 of the
// second migration chantier re-enables it with /competitions paths, UUID-safe
// params (no parseInt), and tenantGuard('competitions') on every route.
//
// These tests pin four things:
//   1. The router is mounted on /competitions and answers 200 (no more 404).
//   2. The old /competitions/... paths are gone (404, not 200).
//   3. A PLAYER is rejected on every route (ADMIN_ROLES gate).
//   4. A competition UUID passed in :id reaches the handler AS A STRING, not
//      as parseInt('3f2a...') === 3. This is the silent-corruption risk Phase 9
//      flags — if a future change reintroduces parseInt(req.params.id), the
//      "forwards UUID as string" test catches it.
//
// We mock tenantGuard the same way as routes-competitions.test.js: it reads
// organizationId from the JWT and sets it on req, then calls next(). The real
// tenantGuard is exercised E2E by server/test-tenant-guard.js.

const express = require('express');
const request = require('supertest');
const { generateToken } = require('../middleware/auth');
const multer = require('multer');

// Mock tenantGuard BEFORE importing the router — reads organizationId from the
// JWT and sets it on req, then next(). Isolates the route handler logic from
// the raw-SQL ownership check (which needs a live DB). The real tenantGuard is
// exercised E2E.
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

// Mock the import/export services so no real Excel parsing happens.
const mockImportService = {
  parseExcel: jest.fn(() => ({ rows: [{ name: 'Alice', school: 'School A', age: 12 }] })),
  validateRows: jest.fn((rows) => ({ valid: rows, invalid: [] })),
};
const mockExportService = {
  generateExportBuffer: jest.fn(() => Buffer.from('fake-xlsx')),
};

jest.mock('../services/ParticipantImportService', () => {
  return jest.fn(() => mockImportService);
});
jest.mock('../services/ParticipantExportService', () => {
  return jest.fn(() => mockExportService);
});

// Mock Prisma — the new global GET /participants route calls prisma.players
// .findMany() directly (the tenant guard is the WHERE clause, so the
// filter lives in the SQL, not in a repo method). We expose the mock so
// tests can assert on the exact WHERE the route builds — that clause IS
// the security boundary.
const mockPlayersFindMany = jest.fn(async () => []);
jest.mock('../db/prisma', () => ({
  getPrisma: () => ({
    players: { findMany: mockPlayersFindMany },
  }),
}));

const { createParticipantRouter } = require('../routes/participants');

// Real JWT tokens (same helper as production). organization_id flows into
// organizationId in the JWT payload.
const ADMIN_TOKEN = generateToken({ id: 1, username: 'admin', role: 'ORG_ADMIN', organization_id: 'org-admin' });
const PLAYER_TOKEN = generateToken({ id: 3, username: 'player1', role: 'PLAYER', organization_id: 'org-admin' });

function buildApp(repos) {
  const app = express();
  app.use(express.json());
  app.use('/api', createParticipantRouter(repos));
  // SPA-style 404 fallback mirroring index.js, so unmatched /api paths
  // return the standard envelope instead of hanging.
  app.use((req, res) => res.status(404).json({ code: 404, message: 'Interface not found', data: null }));
  return app;
}

// Minimal repos — the router uses repos.competitions.findById and the four
// repos.participants methods. We record the arguments so the UUID-integrity
// test can inspect them.
function buildRepos() {
  return {
    competitions: {
      findById: jest.fn(async (id) => ({ id, name: 'Cup', created_at: new Date('2025-01-01') })),
    },
    participants: {
      bulkImport: jest.fn(async () => ({ imported: 1 })),
      findByCompetition: jest.fn(async () => []),
      deleteByCompetition: jest.fn(async () => 1),
      getExportData: jest.fn(async () => [{ id: 'p1', name: 'Alice', account: 'alice', password: null }]),
    },
  };
}

describe('participant router — Phase 9 (reactivated)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/competitions/:id/participants answers 200 (router mounted on /competitions)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/competitions/comp-1/participants')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
  });

  // Written from fragments so a project-wide replace on "tournament" cannot
  // silently rewrite this legacy path into the live one.
  test('the legacy participants path answers 404', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/tour' + 'naments/comp-1/participants')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });

  test('POST /api/competitions/:id/participants/confirm forwards UUID as a string (no parseInt)', async () => {
    const repos = buildRepos();
    const UUID = '3f2a9c14-1234-4abc-9def-000000000001';
    const app = buildApp(repos);
    const res = await request(app)
      .post(`/api/competitions/${UUID}/participants/confirm`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ rows: [{ name: 'Alice', school: 'School A' }] });
    expect(res.status).toBe(200);
    // bulkImport received the UUID verbatim, not as a number.
    expect(repos.participants.bulkImport).toHaveBeenCalledWith(
      UUID,
      expect.any(Array),
      expect.any(String)
    );
    // And NOT as a number — this is the parseInt corruption guard.
    const receivedId = repos.participants.bulkImport.mock.calls[0][0];
    expect(typeof receivedId).toBe('string');
    expect(receivedId).toBe(UUID);
  });

  test('DELETE /api/competitions/:id/participants rejects PLAYER (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .delete('/api/competitions/comp-1/participants')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('POST /api/competitions/:id/participants/upload rejects PLAYER (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions/comp-1/participants/upload')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .attach('file', Buffer.from('fake'), { filename: 'test.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(403);
  });

  test('GET /api/competitions/:id/participants/export returns XLSX buffer for ORG_ADMIN', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/competitions/comp-1/participants/export')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(mockExportService.generateExportBuffer).toHaveBeenCalled();
  });
});

// GET /api/participants — global list (F32).
// The tenant guard for this route is NOT a middleware; it is the WHERE
// clause the route hands to Prisma. These tests therefore assert on the
// exact WHERE received by prisma.players.findMany — the security boundary
// itself. Any regression in the clause fails at least one of these tests
// before it can reach production.
describe('GET /api/participants — global list (F32)', () => {
  const SUPER_TOKEN = generateToken({ id: 42, username: 'root', role: 'SUPER_ADMIN', organization_id: null });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlayersFindMany.mockResolvedValue([]);
  });

  test('ORG_ADMIN request → WHERE competitions.organization_id = caller org', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/participants')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(mockPlayersFindMany).toHaveBeenCalledTimes(1);
    const call = mockPlayersFindMany.mock.calls[0][0];
    // The tenant filter — the whole point of the security review.
    expect(call.where.competitions).toEqual({ organization_id: 'org-admin' });
  });

  test('SUPER_ADMIN request → no organization_id restriction', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/participants')
      .set('Authorization', `Bearer ${SUPER_TOKEN}`);
    expect(res.status).toBe(200);
    const call = mockPlayersFindMany.mock.calls[0][0];
    expect(call.where.competitions).toEqual({});
  });

  test('ORG_ADMIN with ?competitionId of ANOTHER org → org filter still applies (empty result)', async () => {
    // This is the multi-tenant attack path we must block: an admin of
    // org A tries to sniff participants of org B by passing its
    // competition id. The WHERE clause combines competition_id AND the
    // org filter, so Prisma naturally returns nothing — but if a future
    // refactor ever drops the org filter when competitionId is
    // provided, this test flips red.
    const app = buildApp(buildRepos());
    await request(app)
      .get('/api/participants?competitionId=compet-of-org-b')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    const call = mockPlayersFindMany.mock.calls[0][0];
    expect(call.where.competitions).toEqual({ organization_id: 'org-admin' });
    expect(call.where.competition_id).toBe('compet-of-org-b');
  });

  test('filters by ?categoryId', async () => {
    const app = buildApp(buildRepos());
    await request(app)
      .get('/api/participants?categoryId=cat-u12')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    const call = mockPlayersFindMany.mock.calls[0][0];
    expect(call.where.category_id).toBe('cat-u12');
  });

  test('filters by ?search — case-insensitive OR on name/school', async () => {
    const app = buildApp(buildRepos());
    await request(app)
      .get('/api/participants?search=Marie')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    const call = mockPlayersFindMany.mock.calls[0][0];
    expect(call.where.OR).toEqual([
      { name:   { contains: 'Marie', mode: 'insensitive' } },
      { school: { contains: 'Marie', mode: 'insensitive' } },
    ]);
  });

  test('empty ?search string is ignored (no OR filter added)', async () => {
    const app = buildApp(buildRepos());
    await request(app)
      .get('/api/participants?search=')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    const call = mockPlayersFindMany.mock.calls[0][0];
    expect(call.where.OR).toBeUndefined();
  });

  test('flattens the Prisma result — page-friendly rows', async () => {
    mockPlayersFindMany.mockResolvedValue([
      {
        id: 'p1',
        name: 'Alice',
        school: 'School A',
        age: 12,
        province: 'Beijing',
        city: null,
        created_at: new Date('2026-08-01T00:00:00Z'),
        categories: { id: 'cat-u12', name: 'U12' },
        competitions: { id: 'comp-1', name: 'Spring Cup', status: 'FINISHED' },
      },
    ]);
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/participants')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.data).toEqual([{
      id: 'p1',
      name: 'Alice',
      school: 'School A',
      age: 12,
      province: 'Beijing',
      city: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      categoryId: 'cat-u12',
      categoryName: 'U12',
      competitionId: 'comp-1',
      competitionName: 'Spring Cup',
      competitionStatus: 'FINISHED',
    }]);
  });

  test('PLAYER → 403 (ADMIN_ROLES gate)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/participants')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(403);
    expect(mockPlayersFindMany).not.toHaveBeenCalled();
  });

  test('missing Authorization → 401', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).get('/api/participants');
    expect(res.status).toBe(401);
    expect(mockPlayersFindMany).not.toHaveBeenCalled();
  });

  test('Prisma throws → returns 50000 envelope, not a crash', async () => {
    mockPlayersFindMany.mockRejectedValueOnce(new Error('DB down'));
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/participants')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(50000);
  });
});
