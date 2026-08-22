// Unit tests for the competition "setup" routes (rounds, puzzles, teams, judges).
//
// In Phase 4 of the tournament→competition migration, the 5 CRUD competition
// routes (POST/GET/PUT/DELETE /competitions) moved to routes/competitions.js
// and are tested in routes-competitions.test.js. What remained in
// routes/competitions.js was the SETUP of a competition: its rounds, puzzles,
// teams, and judges. In Phase 5 that file was renamed to
// routes/competitionSetup.js, its factory to createCompetitionSetupRouter,
// and its paths from /competitions/:id/... to /competitions/:id/....
//
// We mount the competition setup router on a tiny Express app with MOCKED
// repos so no real database is needed. Real JWT tokens are minted with the
// same `generateToken` helper the production app uses, so the auth middleware
// actually verifies them (not stubbed).
//
// tenantGuard is mocked: it reads organizationId from the JWT and sets it on
// req, then calls next(). This isolates the route handler logic from the
// raw-SQL ownership check (which needs a live DB). The real tenantGuard is
// exercised by server/test-tenant-guard.js (E2E).

const express = require('express');
const request = require('supertest');
const { generateToken } = require('../middleware/auth');

// Mock tenantGuard BEFORE importing the router — same mock as in
// routes-competitions.test.js. Reads organizationId from the JWT and sets it
// on req, then next().
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

const { createCompetitionSetupRouter } = require('../routes/competitionSetup');

// Mint real JWT tokens. organization_id flows into organizationId in the JWT.
const ADMIN_TOKEN = generateToken({ id: 1, username: 'admin', role: 'ORG_ADMIN', organization_id: 'org-admin' });
const PLAYER_TOKEN = generateToken({ id: 3, username: 'player1', role: 'PLAYER', organization_id: 'org-admin' });
const JUDGE_TOKEN = generateToken({ id: 2, username: 'judge', role: 'JUDGE', organization_id: 'org-admin' });
const LEGACY_ADMIN_TOKEN = generateToken({ id: 4, username: 'legacy', role: 'ADMIN' });

// Mock repos factory. Only the methods the competition setup router touches are
// implemented. Each test gets a fresh instance so call counters reset.
function buildRepos(overrides = {}) {
  const defaults = {
    competitions: {
      findById: async (id) => ({ id, name: 'Cup A', status: 'PENDING', organization_id: 'org-admin' }),
    },
    rounds: {
      countByCompetition: async () => 0,
      // A round now belongs to a stage, so create() is called with stageId.
      create: async ({ stageId, name, roundType, durationSeconds }) => ({
        id: 'round-10', stage_id: stageId,
        name, type: roundType, duration_seconds: durationSeconds, status: 'WAITING',
      }),
      // Default stage: a TEAM stage of competition "1", matching the ids the
      // tests below use in their URLs.
      findStageById: async (stageId) => ({ id: stageId, competition_id: '1', type: 'TEAM', order_number: 1 }),
      findWithPuzzles: async () => [],
      findById: async (roundId) => ({ id: roundId, competition_id: 'comp-1' }),
    },
    teams: {
      create: async ({ competitionId, name }) => ({ id: 20, competition_id: competitionId, name }),
      findByCompetitionWithMembers: async () => [],
      findByCompetitionWithMemberCount: async () => [],
      getMembers: async () => [],
      getJudges: async () => [],
      memberExists: async () => false,
      findById: async () => ({ id: 20, competition_id: 'comp-1' }),
      playerInOtherTeam: async () => false,
      addMember: async () => ({}),
      judgeAlreadyAssigned: async () => false,
      assignJudge: async () => ({}),
    },
    puzzles: {
      findByRoundSummary: async () => [],
      create: async () => ({}),
    },
  };
  return {
    competitions: { ...defaults.competitions, ...overrides.competitions },
    rounds: { ...defaults.rounds, ...overrides.rounds },
    teams: { ...defaults.teams, ...overrides.teams },
    puzzles: { ...defaults.puzzles, ...overrides.puzzles },
  };
}

function buildApp(repos) {
  // Mock Prisma for the two-hop security checks in competitionSetup.js.
  // These checks verify round/stage/competition ownership via Prisma queries.
  // The mock returns sensible defaults — individual tests override as needed.
  const mockPrisma = {
    competition_stages: {
      findFirst: async () => ({ id: 'stage-1', competition_id: '1' }),
    },
    competitions: {
      findFirst: async () => ({ id: 'comp-1', organization_id: 'org-admin' }),
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api', createCompetitionSetupRouter(repos, mockPrisma));
  return app;
}

// Rounds are created inside a stage. The route checks three things beyond
// authentication: that the stage exists, that it belongs to the competition in
// the URL, and that the round type suits the stage category.
const ROUNDS_URL = '/api/competitions/1/stages/stage-1/rounds';

describe('POST /api/competitions/:id/stages/:stageId/rounds', () => {
  test('ADMIN creates a round in a stage -> 200', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post(ROUNDS_URL)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Round 1', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 });
    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('ROUND1_NINE_ONE');
    expect(res.body.data.stage_id).toBe('stage-1');
  });

  // The individual types used to be rejected by the schema, which made
  // INDIVIDUAL stages unusable.
  test('an individual round is accepted in an INDIVIDUAL stage', async () => {
    const app = buildApp(buildRepos({
      rounds: { findStageById: async (id) => ({ id, competition_id: '1', type: 'INDIVIDUAL' }) },
    }));
    const res = await request(app)
      .post(ROUNDS_URL)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Solo', roundType: 'INDIVIDUAL_STANDARD', durationSeconds: 600 });
    expect(res.body.code).toBe(200);
  });

  test('a team round is refused in an INDIVIDUAL stage (code 40011)', async () => {
    const app = buildApp(buildRepos({
      rounds: { findStageById: async (id) => ({ id, competition_id: '1', type: 'INDIVIDUAL' }) },
    }));
    const res = await request(app)
      .post(ROUNDS_URL)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'R', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 });
    expect(res.body.code).toBe(40011);
  });

  test('a stage belonging to another competition is refused (code 40400)', async () => {
    const app = buildApp(buildRepos({
      rounds: { findStageById: async (id) => ({ id, competition_id: 'someone-else', type: 'TEAM' }) },
    }));
    const res = await request(app)
      .post(ROUNDS_URL)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'R', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 });
    expect(res.body.code).toBe(40400);
  });

  test('an unknown stage is refused (code 40400)', async () => {
    const app = buildApp(buildRepos({
      rounds: { findStageById: async () => null },
    }));
    const res = await request(app)
      .post(ROUNDS_URL)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'R', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 });
    expect(res.body.code).toBe(40400);
  });

  // The number of rounds per stage is deliberately open for now.
  test('there is no cap on the number of rounds in a stage', async () => {
    const app = buildApp(buildRepos({ rounds: { countByCompetition: async () => 12 } }));
    const res = await request(app)
      .post(ROUNDS_URL)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'R13', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 });
    expect(res.body.code).toBe(200);
  });

  test('invalid roundType is rejected by Zod (code 40001)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post(ROUNDS_URL)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'R', roundType: 'HACKED', durationSeconds: 600 });
    expect(res.body.code).toBe(40001);
  });

  test('PLAYER is forbidden (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post(ROUNDS_URL)
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .send({ name: 'R', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 });
    expect(res.status).toBe(403);
  });

  test('missing Authorization -> 401', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post(ROUNDS_URL)
      .send({ name: 'R', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 });
    expect(res.status).toBe(401);
  });

  test('legacy ADMIN token is REJECTED (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post(ROUNDS_URL)
      .set('Authorization', `Bearer ${LEGACY_ADMIN_TOKEN}`)
      .send({ name: 'R', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(40301);
  });
});

describe('GET /api/round-types', () => {
  test('returns the round types allowed in each stage category', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/round-types')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(200);
    expect(res.body.data.TEAM).toContain('ROUND1_NINE_ONE');
    expect(res.body.data.INDIVIDUAL).toContain('INDIVIDUAL_STANDARD');
    // No PK round type is defined yet — the list must be empty, not missing,
    // so the client can tell "none available" from "unknown category".
    expect(res.body.data.PK).toEqual([]);
  });
});

describe('GET /api/competitions/:id/rounds (list rounds)', () => {
  test('authenticated user gets the list', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/competitions/1/rounds')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('unauthenticated -> 401', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).get('/api/competitions/1/rounds');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/rounds/:roundId/puzzles/import', () => {
  const validPuzzles = [
    { initialGrid: [[1, 2], [3, 4]], solution: [[1, 2], [3, 4]] },
  ];

  test('ADMIN imports valid puzzles -> 200 with successCount', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/rounds/r1/puzzles/import')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ puzzles: validPuzzles });
    expect(res.status).toBe(200);
    expect(res.body.data.successCount).toBe(1);
    expect(res.body.data.failCount).toBe(0);
  });

  test('missing puzzles array -> code 40020', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/rounds/r1/puzzles/import')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({});
    expect(res.body.code).toBe(40020);
  });

  test('puzzle missing initialGrid -> counted as fail, not a crash', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/rounds/r1/puzzles/import')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ puzzles: [{ solution: [[1]] }] }); // no initialGrid
    expect(res.status).toBe(200);
    expect(res.body.data.failCount).toBe(1);
    expect(res.body.data.errors[0].message).toBe('缺少棋盘数据');
  });

  test('unknown roundId -> code 40400', async () => {
    const app = buildApp(buildRepos({
      rounds: { findById: async () => null },
    }));
    const res = await request(app)
      .post('/api/rounds/ghost/puzzles/import')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ puzzles: validPuzzles });
    expect(res.body.code).toBe(40400);
  });

  test('PLAYER is forbidden (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/rounds/r1/puzzles/import')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .send({ puzzles: validPuzzles });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/rounds/:roundId/puzzles', () => {
  test('authenticated user gets the list', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/rounds/r1/puzzles')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('unauthenticated -> 401', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).get('/api/rounds/r1/puzzles');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/competitions/:id/teams (create team)', () => {
  test('ADMIN creates a team -> 200', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions/1/teams')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Team Alpha' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Team Alpha');
  });

  test('missing name is rejected by Zod (code 40001)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions/1/teams')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({});
    expect(res.body.code).toBe(40001);
  });

  test('PLAYER is forbidden (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions/1/teams')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/competitions/:id/teams (list teams)', () => {
  test('authenticated user gets the list', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/competitions/1/teams')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /api/teams/:teamId/members (add member)', () => {
  // Valid UUID v4 (Zod's .uuid() requires the version nibble '4' and a
  // variant nibble in 8/9/a/b). The repeating-pattern UUIDs we used before
  // were rejected by Zod.
  const validBody = { playerId: '12345678-1234-4234-8234-123456789012' };

  test('ADMIN adds a new member -> 200', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/teams/20/members')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.data.playerId).toBe(validBody.playerId);
  });

  test('player already in team -> code 40030', async () => {
    const app = buildApp(buildRepos({
      teams: { memberExists: async () => true },
    }));
    const res = await request(app)
      .post('/api/teams/20/members')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(validBody);
    expect(res.body.code).toBe(40030);
  });

  test('player in another team -> code 40030', async () => {
    const app = buildApp(buildRepos({
      teams: { playerInOtherTeam: async () => true },
    }));
    const res = await request(app)
      .post('/api/teams/20/members')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(validBody);
    expect(res.body.code).toBe(40030);
  });

  test('invalid playerId (not UUID) is rejected by Zod (code 40001)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/teams/20/members')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ playerId: 'not-a-uuid' });
    expect(res.body.code).toBe(40001);
  });

  test('PLAYER is forbidden (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/teams/20/members')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .send(validBody);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/competitions/:id/judges (assign judge)', () => {
  // Valid UUID v4 — see note in the members block above.
  const validBody = { judgeId: '87654321-4321-4321-8321-210987654321' };

  test('ADMIN assigns a judge -> 200', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions/1/judges')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.data.judgeId).toBe(validBody.judgeId);
  });

  test('judge already assigned -> code 40010', async () => {
    const app = buildApp(buildRepos({
      teams: { judgeAlreadyAssigned: async () => true },
    }));
    const res = await request(app)
      .post('/api/competitions/1/judges')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(validBody);
    expect(res.body.code).toBe(40010);
  });

  test('invalid judgeId (not UUID) is rejected by Zod (code 40001)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions/1/judges')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ judgeId: 'no' });
    expect(res.body.code).toBe(40001);
  });

  test('JUDGE cannot assign another judge (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions/1/judges')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
      .send(validBody);
    expect(res.status).toBe(403);
  });
});
