// Unit tests for the publish / cancel / publishability routes.
//
// These routes live in routes/competitions.js next to the CRUD and
// access-link routes. They are tested in their own file because the mock
// setup is heavier: the routes read from FIVE Prisma models
// (competitions, competition_judges, players, competition_stages, rounds
// via _count.round_puzzles) and we want to control each one per test.
//
// The case Louise called out as the one that matters most is here:
// "on ajoute une étape après la publication" — the publishability route
// must report the new stage as unconfigured, and a second POST /publish
// must refuse and say what is missing.
//
// We mock tenantGuard the same way routes-competitions.test.js does (reads
// organizationId from the JWT and calls next), and we mock Prisma with
// jest.fn() so each test can shape the data without touching a database.

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

// Mock competitionAuth — not used by publish routes, but the router
// imports it at module load.
jest.mock('../middleware/competitionAuth', () => ({
  competitionLogin: () => (req, res) => res.json({ code: 200, message: 'stub', data: null }),
}));

// Prisma mock — each test calls setPrismaMock(impl) to install the data it
// needs. Default is a competition with everything ready.
//
// Jest requires mock factory variables to be prefixed with `mock` so the
// hoisting does not reference an uninitialized variable. The accessor
// functions below close over the variable lazily, which is the supported
// pattern.
let mockPrisma = null;
function setPrismaMock(impl) { mockPrisma = impl; }
function mockDefaultPrisma() {
  return {
    competitions: {
      // findUnique is called with { where: { id } } for the competition
      // lookup AND with { where: { competition_access_code } } for the
      // collision check during publish. We distinguish them by key.
      findUnique: async ({ where }) => {
        if (where.competition_access_code) {
          // No collision on the generated code — always return null.
          return null;
        }
        const { id } = where;
        return { id, name: 'Cup', status: 'DRAFT', organization_id: 'org-admin' };
      },
      // Capture the data sent to update so tests can assert that publish
      // sets the access code AND status, and that cancel clears it.
      update: async ({ where: { id }, data }) => ({ id, ...data }),
    },
    competition_judges: {
      findMany: async () => [{ user_id: 'j1' }],
    },
    players: {
      findMany: async () => [{ id: 'p1' }],
    },
    competition_stages: {
      findMany: async () => [
        {
          id: 's1', type: 'TEAM', order_number: 1,
          rounds: [{ id: 'r1', _count: { round_puzzles: 2 } }],
        },
      ],
    },
  };
}
jest.mock('../db/prisma', () => ({
  getPrisma: () => mockPrisma || mockDefaultPrisma(),
}));

const { createCompetitionRouter } = require('../routes/competitions');

const ADMIN_TOKEN = generateToken({ id: 1, username: 'admin', role: 'ORG_ADMIN', organization_id: 'org-admin' });
const JUDGE_TOKEN = generateToken({ id: 2, username: 'judge', role: 'JUDGE', organization_id: 'org-admin' });
const PLAYER_TOKEN = generateToken({ id: 3, username: 'player1', role: 'PLAYER', organization_id: 'org-admin' });

function buildApp() {
  const app = express();
  app.use(express.json());
  // Empty repos — publish routes do not use them (they read via getPrisma
  // directly, to centralise the snapshot fetch alongside the rule).
  app.use('/api/competitions', createCompetitionRouter({}));
  return app;
}

beforeEach(() => { mockPrisma = mockDefaultPrisma(); });

describe('GET /api/competitions/:id/publishability', () => {
  test('a fully ready DRAFT competition is publishable', async () => {
    const res = await request(buildApp())
      .get('/api/competitions/c1/publishability')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.publishable).toBe(true);
    expect(res.body.data.missing).toEqual([]);
  });

  test('a missing judge is reported as NO_JUDGE', async () => {
    setPrismaMock({ ...mockDefaultPrisma(), competition_judges: { findMany: async () => [] } });
    const res = await request(buildApp())
      .get('/api/competitions/c1/publishability')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.data.publishable).toBe(false);
    expect(res.body.data.missing).toContain('NO_JUDGE');
  });

  test('a stage with zero rounds is reported as STAGE_EMPTY', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competition_stages: {
        findMany: async () => [{
          id: 's1', type: 'TEAM', order_number: 1, rounds: [],
        }],
      },
    });
    const res = await request(buildApp())
      .get('/api/competitions/c1/publishability')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.data.publishable).toBe(false);
    expect(res.body.data.missing).toContain('STAGE_EMPTY');
  });

  test('a round with zero puzzles is reported as ROUND_EMPTY', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competition_stages: {
        findMany: async () => [{
          id: 's1', type: 'TEAM', order_number: 1,
          rounds: [{ id: 'r1', _count: { round_puzzles: 0 } }],
        }],
      },
    });
    const res = await request(buildApp())
      .get('/api/competitions/c1/publishability')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.data.publishable).toBe(false);
    expect(res.body.data.missing).toContain('ROUND_EMPTY');
  });

  test('the competition status is returned alongside the rule', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where: { id } }) => ({ id, status: 'PUBLISHED' }),
        update: async () => ({}),
      },
    });
    const res = await request(buildApp())
      .get('/api/competitions/c1/publishability')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.data.status).toBe('PUBLISHED');
  });

  test('unknown id → 40400', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: { findUnique: async () => null, update: async () => ({}) },
    });
    const res = await request(buildApp())
      .get('/api/competitions/unknown/publishability')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40400);
  });

  test('JUDGE is forbidden (403) — readiness is admin business', async () => {
    const res = await request(buildApp())
      .get('/api/competitions/c1/publishability')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/competitions/:id/publish', () => {
  test('a fully ready DRAFT competition is published → 200, status PUBLISHED, and NO link is created', async () => {
    // Louise's rule: "publier doit activer le bouton générer; tant qu'une
    // compétition n'est pas publiée on ne peut pas générer le lien."
    // Publishing UNLOCKS link creation, it does not perform it. Minting the
    // link stays the sole job of POST /:id/access-link, which refuses while
    // the status is DRAFT. Two code paths producing the same link would drift.
    const updates = [];
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where }) => {
          if (where.competition_access_code) return null; // no collision
          return { id: where.id, name: 'Cup', status: 'DRAFT', organization_id: 'org-admin' };
        },
        update: async ({ where, data }) => { updates.push({ where, data }); return { id: where.id, ...data }; },
      },
    });
    const res = await request(buildApp())
      .post('/api/competitions/c1/publish')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.status).toBe('PUBLISHED');
    // No link in the response, and none written to the database.
    expect(res.body.data.accessCode).toBeUndefined();
    expect(res.body.data.entryUrl).toBeUndefined();
    expect(updates).toHaveLength(1);
    expect(updates[0].data.status).toBe('PUBLISHED');
    expect(updates[0].data).not.toHaveProperty('competition_access_code');
  });

  test('the access link cannot be generated while the competition is a DRAFT', async () => {
    // The other half of the same rule, and the half a disabled button cannot
    // enforce: a direct call must be refused too.
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where }) => ({ id: where.id, status: 'DRAFT', organization_id: 'org-admin' }),
        update: async () => { throw new Error('must not write'); },
      },
    });
    const res = await request(buildApp())
      .post('/api/competitions/c1/access-link')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40041);
    expect(res.body.data).toBeNull();
  });

  test('a competition with a missing judge is refused with NO_JUDGE in data.missing', async () => {
    setPrismaMock({ ...mockDefaultPrisma(), competition_judges: { findMany: async () => [] } });
    const res = await request(buildApp())
      .post('/api/competitions/c1/publish')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40010);
    expect(res.body.data.missing).toContain('NO_JUDGE');
    // The message is readable Chinese — the admin must know what is wrong.
    expect(res.body.message).toContain('裁判');
  });

  test('the refusal message lists EVERY missing criterion, not just the first', async () => {
    // Break two criteria at once: no judge AND a stage with no rounds.
    setPrismaMock({
      ...mockDefaultPrisma(),
      competition_judges: { findMany: async () => [] },
      competition_stages: {
        findMany: async () => [{
          id: 's1', type: 'TEAM', order_number: 1, rounds: [],
        }],
      },
    });
    const res = await request(buildApp())
      .post('/api/competitions/c1/publish')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40010);
    expect(res.body.data.missing).toEqual(
      expect.arrayContaining(['NO_JUDGE', 'STAGE_EMPTY'])
    );
    // Both labels appear in the message.
    expect(res.body.message).toContain('裁判');
    expect(res.body.message).toContain('阶段');
  });

  test('a RUNNING competition cannot be published (code 40041)', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where: { id } }) => ({ id, status: 'RUNNING' }),
        update: async () => ({}),
      },
    });
    const res = await request(buildApp())
      .post('/api/competitions/c1/publish')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40041);
  });

  test('a FINISHED competition cannot be published (code 40041)', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where: { id } }) => ({ id, status: 'FINISHED' }),
        update: async () => ({}),
      },
    });
    const res = await request(buildApp())
      .post('/api/competitions/c1/publish')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40041);
  });

  test('unknown id → 40400', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: { findUnique: async () => null, update: async () => ({}) },
    });
    const res = await request(buildApp())
      .post('/api/competitions/unknown/publish')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40400);
  });

  test('JUDGE is forbidden (403)', async () => {
    const res = await request(buildApp())
      .post('/api/competitions/c1/publish')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('PLAYER is forbidden (403)', async () => {
    const res = await request(buildApp())
      .post('/api/competitions/c1/publish')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('unauthenticated → 401', async () => {
    const res = await request(buildApp())
      .post('/api/competitions/c1/publish');
    expect(res.status).toBe(401);
  });

  // THE case Louise called out: "on ajoute une étape après la publication".
  // After publishing, the admin adds a new stage without configuring it.
  // The status is still PUBLISHED (we do not auto-downgrade), but a second
  // publish call must refuse and say what is missing. This pins that the
  // route re-verifies from the real state, not from a stored flag.
  test('re-publishing after adding an unconfigured stage is refused with STAGE_EMPTY', async () => {
    // Step 1: ready state, publish succeeds.
    setPrismaMock(mockDefaultPrisma());
    const first = await request(buildApp())
      .post('/api/competitions/c1/publish')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(first.body.code).toBe(200);

    // Step 2: admin adds a new stage with no rounds. The competition is
    // still PUBLISHED in the status column, but the publishability rule
    // must recompute from the real state.
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where }) => {
          if (where.competition_access_code) return null;
          return { id: where.id, status: 'PUBLISHED' };
        },
        update: async () => ({}),
      },
      competition_stages: {
        findMany: async () => [
          { id: 's1', type: 'TEAM', order_number: 1, rounds: [{ id: 'r1', _count: { round_puzzles: 2 } }] },
          { id: 's2', type: 'INDIVIDUAL', order_number: 2, rounds: [] },
        ],
      },
    });
    const second = await request(buildApp())
      .post('/api/competitions/c1/publish')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    // Status is still PUBLISHED (allowed to re-publish from PUBLISHED), but
    // the publishability check must fail.
    expect(second.body.code).toBe(40010);
    expect(second.body.data.missing).toContain('STAGE_EMPTY');
  });
});

describe('POST /api/competitions/:id/cancel', () => {
  // Louise's decision: "On ne dépublie pas. Mais on peut annuler."
  // Cancelling is DESTRUCTIVE: the access link is destroyed (column cleared),
  // anyone who received the URL can no longer enter, and the competition
  // reverts to DRAFT so it can be edited again. This is NOT a toggle.

  test('a PUBLISHED competition can be cancelled → status DRAFT, access code cleared', async () => {
    // The destructive part: competition_access_code must be set to null in
    // the same update that reverts the status. If only the status is
    // changed, the old link keeps working — which contradicts "le lien est
    // détruit".
    const updates = [];
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where: { id } }) => ({
          id, status: 'PUBLISHED', competition_access_code: 'oldcode1',
        }),
        update: async ({ where, data }) => { updates.push({ where, data }); return { id: where.id, ...data }; },
      },
    });
    const res = await request(buildApp())
      .post('/api/competitions/c1/cancel')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.status).toBe('DRAFT');
    // The single update clears BOTH the status and the access code.
    expect(updates).toHaveLength(1);
    expect(updates[0].data.status).toBe('DRAFT');
    expect(updates[0].data.competition_access_code).toBeNull();
  });

  test('a DRAFT competition can be cancelled (no-op on status, but still clears the code)', async () => {
    // A DRAFT that was never published has no access code to clear, but the
    // route is still allowed: the admin may have cancelled, re-published,
    // and is cancelling again. The status stays DRAFT; the access code
    // (if any) is cleared.
    const updates = [];
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where: { id } }) => ({ id, status: 'DRAFT', competition_access_code: null }),
        update: async ({ where, data }) => { updates.push({ where, data }); return { id: where.id, ...data }; },
      },
    });
    const res = await request(buildApp())
      .post('/api/competitions/c1/cancel')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(200);
    expect(res.body.data.status).toBe('DRAFT');
    expect(updates[0].data.competition_access_code).toBeNull();
  });

  test('a RUNNING competition cannot be cancelled (code 40041)', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where: { id } }) => ({ id, status: 'RUNNING' }),
        update: async () => ({}),
      },
    });
    const res = await request(buildApp())
      .post('/api/competitions/c1/cancel')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40041);
  });

  test('a FINISHED competition cannot be cancelled (code 40041)', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: {
        findUnique: async ({ where: { id } }) => ({ id, status: 'FINISHED' }),
        update: async () => ({}),
      },
    });
    const res = await request(buildApp())
      .post('/api/competitions/c1/cancel')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40041);
  });

  test('unknown id → 40400', async () => {
    setPrismaMock({
      ...mockDefaultPrisma(),
      competitions: { findUnique: async () => null, update: async () => ({}) },
    });
    const res = await request(buildApp())
      .post('/api/competitions/unknown/cancel')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40400);
  });

  test('JUDGE is forbidden (403)', async () => {
    const res = await request(buildApp())
      .post('/api/competitions/c1/cancel')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`);
    expect(res.status).toBe(403);
  });
});
