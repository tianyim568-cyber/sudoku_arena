// Integration tests for the full competition lifecycle.
//
// The other test files in this folder each isolate ONE route — POST /, or
// POST /publish, or POST /access-link. This file chains them: the same
// Express app and the same mocked Prisma instance handle a sequence of
// requests, so we verify that the state written by one route is read
// correctly by the next.
//
// Two kinds of bugs only show up at the seam between routes:
//   1. A route writes the wrong field (e.g. publish forgets to set status)
//      — the next route sees the old state and misbehaves.
//   2. Two routes disagree on the shape of the competition object (e.g.
//      publish writes { status } but access-link expects { status, accessCode }).
//
// The Prisma mock below is a tiny in-memory store: competitions keyed by id,
// with the fields the routes actually read and write. It is reset before
// each test so scenarios are independent.
//
// tenantGuard is mocked the same way routes-publish.test.js already does:
// it reads organizationId from the JWT and calls next(). The real
// tenantGuard is exercised E2E by server/test-tenant-guard.js.

const express = require('express');
const request = require('supertest');
const { generateToken } = require('../middleware/auth');

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

jest.mock('../middleware/competitionAuth', () => ({
  competitionLogin: () => (req, res) => res.json({ code: 200, message: 'stub', data: null }),
}));

// In-memory Prisma mock. Each test starts with an empty store and seeds it
// via seed(). The routes read through the same findUnique/update/findMany
// shape Prisma exposes — so a route that calls prisma.competitions.update
// will mutate the store, and the next route's findUnique will see the
// mutation. This is what makes the lifecycle test an integration test.
function createStore() {
  const competitions = new Map();
  const judges = new Map();   // competitionId -> array of judge user_ids
  const players = new Map();  // competitionId -> array of player ids
  const stages = new Map();   // competitionId -> array of stage objects

  return {
    competitions,
    judges,
    players,
    stages,
    asPrisma() {
      const store = this;
      return {
        competitions: {
          findUnique: async ({ where, select }) => {
            if (where.competition_access_code) {
              for (const c of store.competitions.values()) {
                if (c.competition_access_code === where.competition_access_code) {
                  return store.project(c, select);
                }
              }
              return null;
            }
            const c = store.competitions.get(where.id);
            return c ? store.project(c, select) : null;
          },
          update: async ({ where: { id }, data }) => {
            const c = store.competitions.get(id);
            if (!c) throw new Error('competition not found');
            Object.assign(c, data);
            return store.project(c);
          },
        },
        competition_judges: {
          findMany: async ({ where }) => store.judges.get(where.competition_id) || [],
        },
        players: {
          findMany: async ({ where }) => store.players.get(where.competition_id) || [],
        },
        competition_stages: {
          findMany: async ({ where }) => store.stages.get(where.competition_id) || [],
        },
      };
    },
    // Project only the requested fields. For the info route, Prisma is
    // called with select: { id, name, status, organizations: {...} }.
    project(c, select) {
      if (!select) return { ...c };
      const out = {};
      for (const key of Object.keys(select)) {
        if (key === 'organizations') {
          out.organizations = { name: c.organizationName || 'Acme Ltd.' };
        } else {
          out[key] = c[key];
        }
      }
      return out;
    },
  };
}

let mockPrisma = null;
function setPrismaMock(impl) { mockPrisma = impl; }
jest.mock('../db/prisma', () => ({
  getPrisma: () => mockPrisma,
}));

const { createCompetitionRouter } = require('../routes/competitions');

const ADMIN_TOKEN = generateToken({ id: 1, username: 'admin', role: 'ORG_ADMIN', organization_id: 'org-admin' });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/competitions', createCompetitionRouter({}));
  return app;
}

beforeEach(() => { mockPrisma = null; });

// ── Full lifecycle: create → publishability → publish → access-link →
// by-code/info → cancel → access-link (null) ─────────────────────────────
//
// This scenario walks the happy path a real admin follows. It verifies
// that each route's output feeds correctly into the next one's input —
// the kind of bug that only surfaces when the routes are chained.
describe('full lifecycle: create → publish → access-link → cancel', () => {
  test('the happy path from DRAFT to PUBLISHED to revoked', async () => {
    const store = createStore();
    // Seed a fully-configured DRAFT competition. Publishability will pass
    // because the judge list is non-empty, the stage has one round, and
    // the round has two puzzles.
    store.competitions.set('c1', {
      id: 'c1',
      name: 'Spring Cup',
      status: 'DRAFT',
      organization_id: 'org-admin',
      competition_access_code: null,
    });
    store.judges.set('c1', [{ user_id: 'j1' }]);
    store.players.set('c1', [{ id: 'p1' }]);
    store.stages.set('c1', [
      { id: 's1', type: 'TEAM', order_number: 1, rounds: [{ id: 'r1', _count: { round_puzzles: 2 } }] },
    ]);
    setPrismaMock(store.asPrisma());

    const app = buildApp();

    // Step 1 — readiness check. Should be publishable.
    const ready = await request(app)
      .get('/api/competitions/c1/publishability')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(ready.body.code).toBe(200);
    expect(ready.body.data.publishable).toBe(true);
    expect(ready.body.data.missing).toEqual([]);

    // Step 2 — publish. Status becomes PUBLISHED. No access code yet.
    const pub = await request(app)
      .post('/api/competitions/c1/publish')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(pub.body.code).toBe(200);
    expect(pub.body.data.status).toBe('PUBLISHED');
    expect(pub.body.data.accessCode).toBeUndefined();

    // Step 3 — generate the access link. Now the code exists.
    const link = await request(app)
      .post('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(link.body.code).toBe(200);
    expect(link.body.data.accessCode).toBeTruthy();
    const code = link.body.data.accessCode;

    // Step 4 — read the link back. The code is the same we just generated.
    const read = await request(app)
      .get('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(read.body.data.accessCode).toBe(code);

    // Step 5 — public landing page resolves the code to competition info.
    // No auth header — players arriving with the link must see the info.
    const info = await request(app)
      .get(`/api/competitions/by-code/${code}/info`);
    expect(info.body.code).toBe(200);
    expect(info.body.data.id).toBe('c1');
    expect(info.body.data.name).toBe('Spring Cup');
    expect(info.body.data.status).toBe('PUBLISHED');
    expect(info.body.data.organizationName).toBe('Acme Ltd.');

    // Step 6 — cancel. Status reverts to DRAFT, code is cleared.
    const cancel = await request(app)
      .post('/api/competitions/c1/cancel')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(cancel.body.code).toBe(200);
    expect(cancel.body.data.status).toBe('DRAFT');

    // Step 7 — read the link again. The code is gone — anyone who saved
    // the old URL can no longer enter.
    const after = await request(app)
      .get('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(after.body.data.accessCode).toBeNull();

    // Step 8 — the old code no longer resolves on the public route.
    const infoAfter = await request(app)
      .get(`/api/competitions/by-code/${code}/info`);
    expect(infoAfter.body.code).toBe(40400);
  });
});

// ── Publish refusals block the lifecycle ────────────────────────────────
//
// If publishability fails, the admin cannot publish — and therefore cannot
// generate an access link either. The lifecycle must stop at the gate,
// not limp through to a half-published state.
describe('a competition with missing pieces cannot be published or linked', () => {
  test('a DRAFT competition with no judge is refused at publish AND at access-link', async () => {
    const store = createStore();
    store.competitions.set('c1', {
      id: 'c1', name: 'Cup', status: 'DRAFT',
      organization_id: 'org-admin', competition_access_code: null,
    });
    store.judges.set('c1', []);  // no judge
    store.players.set('c1', [{ id: 'p1' }]);
    store.stages.set('c1', [
      { id: 's1', type: 'TEAM', order_number: 1, rounds: [{ id: 'r1', _count: { round_puzzles: 2 } }] },
    ]);
    setPrismaMock(store.asPrisma());

    const app = buildApp();

    const ready = await request(app)
      .get('/api/competitions/c1/publishability')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(ready.body.data.publishable).toBe(false);
    expect(ready.body.data.missing).toContain('NO_JUDGE');

    const pub = await request(app)
      .post('/api/competitions/c1/publish')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(pub.body.code).toBe(40010);
    expect(pub.body.data.missing).toContain('NO_JUDGE');

    // The competition is still DRAFT — so access-link must refuse too.
    // This is the rule Louise insisted on: "publier ne génère pas le lien;
    // publier active le bouton générer." A DRAFT competition has no link.
    const link = await request(app)
      .post('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(link.body.code).toBe(40041);
  });
});

// ── Regenerating an access link invalidates the old one ──────────────────
//
// Two admin actions produce a new code: POST /access-link on a competition
// that already has one. The old code must stop resolving — otherwise
// players with the saved old URL keep entering after the admin meant to
// revoke it.
describe('regenerating an access link invalidates the previous code', () => {
  test('after regenerate, the old code no longer resolves', async () => {
    const store = createStore();
    store.competitions.set('c1', {
      id: 'c1', name: 'Cup', status: 'PUBLISHED',
      organization_id: 'org-admin', competition_access_code: null,
    });
    store.judges.set('c1', [{ user_id: 'j1' }]);
    store.players.set('c1', [{ id: 'p1' }]);
    store.stages.set('c1', [
      { id: 's1', type: 'TEAM', order_number: 1, rounds: [{ id: 'r1', _count: { round_puzzles: 2 } }] },
    ]);
    setPrismaMock(store.asPrisma());

    const app = buildApp();

    const link1 = await request(app)
      .post('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(link1.body.code).toBe(200);
    const code1 = link1.body.data.accessCode;

    const link2 = await request(app)
      .post('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(link2.body.code).toBe(200);
    const code2 = link2.body.data.accessCode;

    // The codes are different — regenerating is not a no-op.
    expect(code2).not.toBe(code1);

    // The old code no longer resolves on the public route.
    const info1 = await request(app)
      .get(`/api/competitions/by-code/${code1}/info`);
    expect(info1.body.code).toBe(40400);

    // The new code does.
    const info2 = await request(app)
      .get(`/api/competitions/by-code/${code2}/info`);
    expect(info2.body.code).toBe(200);
    expect(info2.body.data.id).toBe('c1');
  });
});

// ── Cancel destroys the link even if the admin does not regenerate ────────
//
// The cancel route clears competition_access_code in the same update that
// reverts the status. This is what makes cancel destructive — without it,
// the old URL would keep working against a competition that is now DRAFT.
describe('cancel destroys the access link even without regenerate', () => {
  test('after cancel, the previous code no longer resolves', async () => {
    const store = createStore();
    store.competitions.set('c1', {
      id: 'c1', name: 'Cup', status: 'PUBLISHED',
      organization_id: 'org-admin', competition_access_code: null,
    });
    store.judges.set('c1', [{ user_id: 'j1' }]);
    store.players.set('c1', [{ id: 'p1' }]);
    store.stages.set('c1', [
      { id: 's1', type: 'TEAM', order_number: 1, rounds: [{ id: 'r1', _count: { round_puzzles: 2 } }] },
    ]);
    setPrismaMock(store.asPrisma());

    const app = buildApp();

    const link = await request(app)
      .post('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    const code = link.body.data.accessCode;

    // Confirm the code resolves before cancel.
    const beforeCancel = await request(app)
      .get(`/api/competitions/by-code/${code}/info`);
    expect(beforeCancel.body.code).toBe(200);

    const cancel = await request(app)
      .post('/api/competitions/c1/cancel')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(cancel.body.code).toBe(200);
    expect(cancel.body.data.status).toBe('DRAFT');

    // After cancel, the code no longer resolves.
    const afterCancel = await request(app)
      .get(`/api/competitions/by-code/${code}/info`);
    expect(afterCancel.body.code).toBe(40400);
  });
});
