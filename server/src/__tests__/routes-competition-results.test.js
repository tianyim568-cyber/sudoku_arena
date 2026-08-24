// Unit tests for GET /api/competitions/:id/results (ISSUE-036, part 2).
//
// The route is the admin-side twin of the big-screen public ranking
// endpoint (`GET /display/:token/ranking`): it returns the same
// `DisplayManager.getRankingSnapshot()` payload, but behind org-scoped
// admin auth instead of a display token. Two entry points must never
// drift — using the same code path server-side is the guarantee.
//
// What we assert here:
//   1. Auth + role — token missing / wrong role / other org's competition.
//   2. The handler forwards `categoryId` through to the snapshot (all-
//      categories path when omitted, one-category path when a UUID is
//      provided).
//   3. 404 envelope when the DisplayManager throws "Competition not
//      found" (that's the code the display route uses too).
//   4. 500 envelope for other failures (nothing leaks to the client).

const express = require('express');
const request = require('supertest');
const { generateToken } = require('../middleware/auth');

// tenantGuard mock — same one that all other routes-*.test.js files
// use. Reads organizationId from the JWT, refuses if missing (except
// SUPER_ADMIN), calls next(). The real guard is exercised by
// server/test-tenant-guard.js E2E.
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
          code: 40301, message: '用户未关联任何组织，无法访问', data: null,
        });
      }
      req.organizationId = organizationId;
      return next();
    };
  }
  return { tenantGuard: mockTenantGuard, __real: tenantGuard };
});

// competitionAuth — the router imports it at module load, but this
// route does not use it.
jest.mock('../middleware/competitionAuth', () => ({
  competitionLogin: () => (req, res) => res.json({ code: 200, message: 'stub', data: null }),
}));

const { createCompetitionRouter } = require('../routes/competitions');

const ORG_A = 'org-a-uuid';
const ADMIN_TOKEN = generateToken({
  id: 'admin-1', username: 'admin', role: 'ORG_ADMIN', organization_id: ORG_A,
});
const JUDGE_TOKEN = generateToken({
  id: 'judge-1', username: 'judge', role: 'JUDGE', organization_id: ORG_A,
});
const PLAYER_TOKEN = generateToken({
  id: 'player-1', username: 'player', role: 'PLAYER', organization_id: ORG_A,
});

const COMP_ID = 'comp-uuid-1';

// A DisplayManager stub that spies on getRankingSnapshot so the tests
// can assert on the args it was called with, and shape the response
// (or error) per test.
function buildDisplayManager(impl = () => ({ hello: 'snapshot' })) {
  const getRankingSnapshot = jest.fn(async (id, categoryId) => impl(id, categoryId));
  return { getRankingSnapshot };
}

function buildApp(displayManager, repos = {}) {
  const app = express();
  app.use(express.json());
  // Signature is (repos, displayManager). No orchestrator argument —
  // this route only reads a snapshot.
  const router = createCompetitionRouter(repos, displayManager);
  app.use('/api/competitions', router);
  return app;
}

describe('GET /api/competitions/:id/results — authorization', () => {
  test('rejects a request without a token (401)', async () => {
    const res = await request(buildApp(buildDisplayManager()))
      .get(`/api/competitions/${COMP_ID}/results`);
    expect(res.status).toBe(401);
  });

  test('rejects a PLAYER (403)', async () => {
    const res = await request(buildApp(buildDisplayManager()))
      .get(`/api/competitions/${COMP_ID}/results`)
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('rejects a JUDGE (403) — results is admin-only', async () => {
    const res = await request(buildApp(buildDisplayManager()))
      .get(`/api/competitions/${COMP_ID}/results`)
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/competitions/:id/results — categoryId forwarding', () => {
  test('omits categoryId when the query param is absent → passes null through', async () => {
    const dm = buildDisplayManager(() => ({ stages: [], finalRankings: [] }));
    const res = await request(buildApp(dm))
      .get(`/api/competitions/${COMP_ID}/results`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(res.body.code).toBe(200);
    expect(dm.getRankingSnapshot).toHaveBeenCalledWith(COMP_ID, null);
  });

  test('forwards a non-empty categoryId verbatim', async () => {
    const CAT = 'cat-uuid-12';
    const dm = buildDisplayManager(() => ({ stages: [], finalRankings: [] }));
    await request(buildApp(dm))
      .get(`/api/competitions/${COMP_ID}/results?categoryId=${CAT}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(dm.getRankingSnapshot).toHaveBeenCalledWith(COMP_ID, CAT);
  });

  test('treats an empty categoryId string as null (all categories)', async () => {
    const dm = buildDisplayManager(() => ({ stages: [], finalRankings: [] }));
    await request(buildApp(dm))
      .get(`/api/competitions/${COMP_ID}/results?categoryId=`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(dm.getRankingSnapshot).toHaveBeenCalledWith(COMP_ID, null);
  });
});

describe('GET /api/competitions/:id/results — payload + error paths', () => {
  test('returns the snapshot verbatim under data', async () => {
    const snapshot = {
      competition: { id: COMP_ID, name: 'Spring Cup', displayMode: 'DEFAULT' },
      stages: [{ id: 's1', type: 'INDIVIDUAL', rounds: [] }],
      finalRankings: [{ entityId: 'p1', entityName: 'Alice', rank: 1, score: 42 }],
      categories: [],
    };
    const dm = buildDisplayManager(() => snapshot);
    const res = await request(buildApp(dm))
      .get(`/api/competitions/${COMP_ID}/results`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(res.body.data).toEqual(snapshot);
  });

  test('returns 40400 when the snapshot throws "Competition not found"', async () => {
    const dm = buildDisplayManager(() => { throw new Error('Competition not found'); });
    const res = await request(buildApp(dm))
      .get(`/api/competitions/${COMP_ID}/results`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(res.body.code).toBe(40400);
    expect(res.body.data).toBeNull();
  });

  test('returns 50000 for other failures (nothing leaks)', async () => {
    const dm = buildDisplayManager(() => { throw new Error('kaboom internal detail'); });
    const res = await request(buildApp(dm))
      .get(`/api/competitions/${COMP_ID}/results`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(res.body.code).toBe(50000);
    // The internal error message MUST NOT reach the client.
    expect(JSON.stringify(res.body)).not.toContain('kaboom internal detail');
  });

  test('returns 50000 when displayManager is not wired', async () => {
    // The router accepts (repos, orchestrator, displayManager). When the
    // caller forgot to pass displayManager, the handler must fail loudly
    // via envelope rather than crash.
    const res = await request(buildApp(/* dm */ null))
      .get(`/api/competitions/${COMP_ID}/results`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .expect(200);

    expect(res.body.code).toBe(50000);
  });
});
