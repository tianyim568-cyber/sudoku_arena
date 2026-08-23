// Unit tests for the competition CRUD routes (POST/GET/PUT/DELETE /api/competitions).
// These routes were moved here from routes/competitions.js in Phase 4 of the
// tournament→competition migration. We mount the competition router on a tiny
// Express app with MOCKED repos so no real database is needed. Real JWT tokens
// are minted with the same `generateToken` helper the production app uses, so
// the auth middleware actually verifies them (not stubbed).
//
// tenantGuard is mocked the same way as in routes-competitions.test.js: it reads
// organizationId from the JWT and sets it on req, then calls next(). This
// isolates the route handler logic from the raw-SQL ownership check (which
// needs a live DB). The real tenantGuard is exercised by server/test-tenant-guard.js
// (E2E).
//
// NOTE: the access-link and by-code routes (Sylvain's) are NOT tested here —
// they need a real Prisma client. This file only covers the 5 CRUD routes that
// were moved over in Phase 4.

const express = require('express');
const request = require('supertest');
const { generateToken } = require('../middleware/auth');

// Mock tenantGuard BEFORE importing the router — same mock as in
// routes-competitions.test.js. Reads organizationId from the JWT and sets it
// on req, then next(). The real tenantGuard is exercised E2E.
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

// Mock competitionAuth (competitionLogin) — not used by the CRUD routes, but
// the router imports it at module load. We stub it so no real Prisma is needed.
jest.mock('../middleware/competitionAuth', () => ({
  competitionLogin: () => (req, res) => res.json({ code: 200, message: 'stub', data: null }),
}));

// Mock prisma — the CRUD routes use repos (mocked below), but the router file
// imports getPrisma for the access-link routes. Stub it defensively.
jest.mock('../db/prisma', () => ({
  getPrisma: () => ({ competitions: { findUnique: async () => null, update: async () => ({}) } }),
}));

const { createCompetitionRouter } = require('../routes/competitions');

// Mint real JWT tokens. organization_id flows into organizationId in the JWT
// (see generateToken in middleware/auth.js).
const ADMIN_TOKEN = generateToken({ id: 1, username: 'admin', role: 'ORG_ADMIN', organization_id: 'org-admin' });
const SUPER_ADMIN_TOKEN = generateToken({ id: 5, username: 'super', role: 'SUPER_ADMIN' });
const SUPER_ADMIN_WITH_ORG_TOKEN = generateToken({ id: 5, username: 'super', role: 'SUPER_ADMIN', organization_id: 'org-admin' });
const JUDGE_TOKEN = generateToken({ id: 2, username: 'judge', role: 'JUDGE', organization_id: 'org-admin' });
const PLAYER_TOKEN = generateToken({ id: 3, username: 'player1', role: 'PLAYER', organization_id: 'org-admin' });
const ADMIN_NO_ORG_TOKEN = generateToken({ id: 6, username: 'noorg', role: 'ORG_ADMIN' });
const LEGACY_ADMIN_TOKEN = generateToken({ id: 4, username: 'legacy', role: 'ADMIN' });

// Mock repos factory — same shape as in routes-competitions.test.js. Only the
// methods the 5 CRUD routes touch are implemented.
function buildRepos(overrides = {}) {
  const defaults = {
    competitions: {
      create: async ({ name, description, scheduledTime, createdBy, organizationId }) => ({
        id: 'comp-new', name, description: description || '',
        organization_id: organizationId || null,
        scheduled_time: scheduledTime || null,
        status: 'DRAFT', created_by: createdBy,
      }),
      findAll: async (organizationId) => {
        if (!organizationId) {
          return [
            { id: 'comp-A', name: 'Cup A', organization_id: 'org-admin' },
            { id: 'comp-B', name: 'Cup B', organization_id: 'org-B' },
          ];
        }
        return [{ id: 'comp-A', name: 'Cup A', organization_id: organizationId }];
      },
      findById: async (id) => {
        if (id === '999' || id === 999) return null;
        return { id, name: 'Cup A', status: 'DRAFT', organization_id: 'org-admin' };
      },
      deleteCascade: async (id) => ({ deleted: id }),
      update: async (id, { name, description, scheduledTime }) => ({
        id, name: name || 'Cup A', description: description || '',
        scheduled_time: scheduledTime || null, status: 'DRAFT',
      }),
    },
    rounds: { findWithPuzzles: async () => [] },
    teams: {
      findByCompetitionWithMemberCount: async () => [],
      getMembers: async () => [],
      getJudges: async () => [],
    },
  };
  return {
    competitions: { ...defaults.competitions, ...overrides.competitions },
    rounds: { ...defaults.rounds, ...overrides.rounds },
    teams: { ...defaults.teams, ...overrides.teams },
  };
}

function buildApp(repos) {
  const app = express();
  app.use(express.json());
  app.use('/api/competitions', createCompetitionRouter(repos));
  return app;
}

describe('POST /api/competitions (create competition)', () => {
  test('ADMIN with valid body -> 200 + created competition', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'New Cup', description: 'desc' });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.name).toBe('New Cup');
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.organization_id).toBe('org-admin');
  });

  test('PLAYER is forbidden (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(40301);
  });

  test('JUDGE is forbidden (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  test('missing Authorization -> 401', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).post('/api/competitions').send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  test('missing name is rejected by Zod (code 40001)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ description: 'no name' });
    expect(res.body.code).toBe(40001);
  });

  test('empty name is rejected by Zod (code 40001)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: '' });
    expect(res.body.code).toBe(40001);
  });

  // Phase 3 contract (carried over): SUPER_ADMIN without a target org must get
  // a clear 40001 instead of a Prisma NOT NULL crash.
  test('SUPER_ADMIN without organization -> 40001 (缺少组织标识)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions')
      .set('Authorization', `Bearer ${SUPER_ADMIN_TOKEN}`)
      .send({ name: 'Cup super' });
    expect(res.body.code).toBe(40001);
    expect(res.body.message).toBe('缺少组织标识');
  });
});

describe('GET /api/competitions (list)', () => {
  test('any authenticated user gets the list', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/competitions')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test('unauthenticated -> 401', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).get('/api/competitions');
    expect(res.status).toBe(401);
  });

  // ORG_ADMIN sees only competitions from its own org.
  test('ORG_ADMIN only sees competitions from its own org', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/competitions')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].organization_id).toBe('org-admin');
  });

  // SUPER_ADMIN (no org) sees all competitions.
  test('SUPER_ADMIN sees all competitions (no org filter)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/competitions')
      .set('Authorization', `Bearer ${SUPER_ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });
});

describe('GET /api/competitions/:id (detail)', () => {
  test('existing competition returns 200 with rounds/teams/judges', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/competitions/1')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('1');
    expect(Array.isArray(res.body.data.rounds)).toBe(true);
    expect(Array.isArray(res.body.data.teams)).toBe(true);
    expect(Array.isArray(res.body.data.judges)).toBe(true);
  });

  test('unknown id returns code 40400', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/competitions/999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40400);
    expect(res.body.data).toBeNull();
  });

  // Regression: UUIDs must pass through req.params intact. parseInt() used to
  // silently corrupt them. Carried over from Phase 3.
  test('UUID id is passed through to the repo without parseInt corruption', async () => {
    const repos = buildRepos();
    let receivedId = null;
    repos.competitions.findById = async (id) => {
      receivedId = id;
      return { id, name: 'Cup UUID', status: 'PENDING', organization_id: 'org-admin' };
    };
    const app = buildApp(repos);
    const uuid = '3f2a1b8c-1234-5678-9abc-def012345678';
    const res = await request(app)
      .get(`/api/competitions/${uuid}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(receivedId).toBe(uuid);
  });
});

describe('PUT /api/competitions/:id (update)', () => {
  test('ADMIN updates a PENDING competition -> 200', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .put('/api/competitions/1')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed');
  });

  test('a RUNNING competition cannot be updated (code 40041)', async () => {
    const app = buildApp(buildRepos({
      competitions: { findById: async () => ({ id: '1', name: 'X', status: 'RUNNING' }) },
    }));
    const res = await request(app)
      .put('/api/competitions/1')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Renamed' });
    expect(res.body.code).toBe(40041);
  });

  test('unknown id returns code 40400', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .put('/api/competitions/999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'X' });
    expect(res.body.code).toBe(40400);
  });

  test('PLAYER is forbidden (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .put('/api/competitions/1')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/competitions/:id', () => {
  test('ADMIN deletes a DRAFT competition -> 200', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .delete('/api/competitions/1')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe('1');
  });

  test('a RUNNING competition cannot be deleted (code 40041)', async () => {
    const app = buildApp(buildRepos({
      competitions: { findById: async () => ({ id: '1', name: 'X', status: 'RUNNING' }) },
    }));
    const res = await request(app)
      .delete('/api/competitions/1')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40041);
  });

  test('unknown id returns code 40400', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .delete('/api/competitions/999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40400);
  });
});

// Regression guard on the competition lifecycle vocabulary.
//
// The UUID migration renamed the statuses (PENDING → DRAFT, IN_PROGRESS →
// RUNNING) but the route guards kept comparing against the old names. Two
// consequences shipped unnoticed: a DRAFT competition could never be renamed
// ("already started"), and a RUNNING one could be deleted mid-game.
//
// The legacy names are assembled from fragments so a project-wide rename
// cannot quietly turn these into assertions about the live vocabulary.
const LEGACY_RUNNING = 'IN_' + 'PROGRESS';
const LEGACY_DRAFT = 'PEND' + 'ING';

describe('competition lifecycle statuses', () => {
  const withStatus = (status) =>
    buildApp(buildRepos({
      competitions: { findById: async () => ({ id: '1', name: 'X', status, organization_id: 'org-admin' }) },
    }));

  test('a DRAFT competition can be renamed', async () => {
    const res = await request(withStatus('DRAFT'))
      .put('/api/competitions/1')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Renamed' });
    expect(res.body.code).toBe(200);
  });

  test('a PUBLISHED competition can still be renamed', async () => {
    const res = await request(withStatus('PUBLISHED'))
      .put('/api/competitions/1')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Renamed' });
    expect(res.body.code).toBe(200);
  });

  test('a RUNNING competition is frozen', async () => {
    const res = await request(withStatus('RUNNING'))
      .put('/api/competitions/1')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Renamed' });
    expect(res.body.code).toBe(40041);
  });

  test('a RUNNING competition cannot be deleted', async () => {
    const res = await request(withStatus('RUNNING'))
      .delete('/api/competitions/1')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40041);
  });

  test('the legacy status names no longer gate anything', async () => {
    // Neither legacy name is written by the server any more. If a guard still
    // compared against them, one of these two would behave like its modern
    // counterpart instead of falling through.
    const renamed = await request(withStatus(LEGACY_DRAFT))
      .put('/api/competitions/1')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Renamed' });
    expect(renamed.body.code).toBe(40041); // not DRAFT/PUBLISHED → frozen

    const deleted = await request(withStatus(LEGACY_RUNNING))
      .delete('/api/competitions/1')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(deleted.body.code).toBe(200); // not RUNNING → deletable
  });
});

// Regression guard: the legacy `ADMIN` role was removed in Phase 1. Routes now
// spread ADMIN_ROLES (['ORG_ADMIN', 'SUPER_ADMIN']), so a token carrying the
// ghost `ADMIN` role must be rejected — while a `SUPER_ADMIN` (platform owner
// targeting an org) is accepted alongside `ORG_ADMIN`.
describe('administrator roles accepted by the competition routes', () => {
  test('ORG_ADMIN can create a competition', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Cup ORG' });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
  });

  test('SUPER_ADMIN (with target org) can also create a competition', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions')
      .set('Authorization', `Bearer ${SUPER_ADMIN_WITH_ORG_TOKEN}`)
      .send({ name: 'Cup super' });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
  });

  test('legacy ADMIN token is REJECTED (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions')
      .set('Authorization', `Bearer ${LEGACY_ADMIN_TOKEN}`)
      .send({ name: 'Cup legacy' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(40301);
  });

  test('a PLAYER is still refused (code 40301)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .send({ name: 'Cup player' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(40301);
  });
});

// Regression guard: the legacy /api/tournaments CRUD paths must not come back.
// Both live routers (createCompetitionRouter + createCompetitionSetupRouter)
// speak /competitions exclusively, so every legacy path has to fall through to
// the 404 handler.
//
// The legacy prefix is assembled from fragments on purpose. Written whole, a
// project-wide search-and-replace on "tournament" would silently rewrite these
// URLs into /api/competitions — turning a guard against the old paths into a
// test asserting the new ones are broken. That exact accident happened once.
const LEGACY = '/api/tour' + 'naments';

describe('the legacy CRUD paths are gone', () => {
  // Mount BOTH routers the way index.js does, so we can assert neither of them
  // picks up a legacy path.
  function buildFullApp(repos) {
    const { createCompetitionSetupRouter } = require('../routes/competitionSetup');
    const app = express();
    app.use(express.json());
    app.use('/api/competitions', createCompetitionRouter(repos));
    const mockPrisma = {
      competition_stages: { findFirst: async () => ({ id: 'stage-1', competition_id: '1' }) },
      competitions: { findFirst: async () => ({ id: 'comp-1', organization_id: 'org-admin' }) },
    };
    app.use('/api', createCompetitionSetupRouter(repos, mockPrisma));
    // SPA-style 404 fallback mirroring index.js, so unmatched /api paths
    // return the standard envelope instead of hanging.
    app.use((req, res) => res.status(404).json({ code: 404, message: 'Interface not found', data: null }));
    return app;
  }

  const CASES = [
    ['post', LEGACY, { name: 'Ghost' }],
    ['get', LEGACY, null],
    ['get', `${LEGACY}/1`, null],
    ['put', `${LEGACY}/1`, { name: 'X' }],
    ['delete', `${LEGACY}/1`, null],
  ];

  test.each(CASES)('%s %s -> 404 (not 200)', async (method, path, body) => {
    const app = buildFullApp(buildRepos());
    const req = request(app)[method](path).set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    const res = body ? await req.send(body) : await req;
    expect(res.status).toBe(404);
  });
});

// Regression guard: CompetitionRepository.findAll scoping (carried over from
// routes-competitions.test.js Phase 2). The repository's optional organizationId
// filter is the core multi-tenancy contract — keep pinning it here.
describe('CompetitionRepository.findAll scoping', () => {
  const CompetitionRepository = require('../db/repositories/CompetitionRepository');

  function buildRepo(findManyImpl) {
    const prisma = { competitions: { findMany: findManyImpl } };
    return new CompetitionRepository(prisma);
  }

  test('passes organization_id in the `where` clause when an id is given', async () => {
    const seen = [];
    const repo = buildRepo(async (args) => {
      seen.push(args);
      return [{ id: 'comp-1', organization_id: 'org-A' }];
    });
    const rows = await repo.findAll('org-A');
    expect(rows.length).toBe(1);
    expect(seen[0]).toEqual({
      where: { organization_id: 'org-A' },
      orderBy: { created_at: 'desc' },
    });
  });

  test('omits the `where` clause when no argument is passed (SUPER_ADMIN path)', async () => {
    const seen = [];
    const repo = buildRepo(async (args) => {
      seen.push(args);
      return [{ id: 'comp-1' }, { id: 'comp-2' }];
    });
    const rows = await repo.findAll();
    expect(rows.length).toBe(2);
    expect(seen[0]).toEqual({
      where: {},
      orderBy: { created_at: 'desc' },
    });
  });

  test('omits the `where` clause when explicitly passed null', async () => {
    const seen = [];
    const repo = buildRepo(async (args) => {
      seen.push(args);
      return [];
    });
    await repo.findAll(null);
    expect(seen[0]).toEqual({
      where: {},
      orderBy: { created_at: 'desc' },
    });
  });
});
