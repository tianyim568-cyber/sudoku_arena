// Unit tests for the game router (Phase 10 — reactivated).
//
// The router was commented out in index.js since migration 018. Phase 10 of the
// second migration chantier re-enables it with /competitions paths, UUID-safe
// params (no parseInt), and tenantGuard('competitions') on every route that
// carries a competition :id.
//
// These tests pin five things:
//   1. The router is mounted on /competitions and answers 200 (no more 404).
//   2. The old /competitions/... paths are gone (404, not 200).
//   3. A PLAYER is rejected on judge-only routes (JUDGE + ADMIN_ROLES gate).
//   4. A JUDGE is accepted on judge-only routes.
//   5. A competition UUID passed in :id reaches the orchestrator AS A STRING,
//      not as parseInt('3f2a...') === 3. This is the silent-corruption risk
//      Phase 10 flags — if a future change reintroduces parseInt(req.params.id),
//      the "forwards UUID as string" test catches it.
//
// We mock tenantGuard the same way as routes-participants.test.js: it reads
// organizationId from the JWT and sets it on req, then calls next(). The real
// tenantGuard is exercised E2E by server/test-tenant-guard.js.
//
// We mock the orchestrator with jest.fn() recorders so tests can assert that
// the UUID reached the orchestrator verbatim. The orchestrator's real behavior
// (WebSocket emissions, state mutations) is out of scope for this unit test.

const express = require('express');
const request = require('supertest');
const { generateToken } = require('../middleware/auth');

// Mock tenantGuard BEFORE importing the router — reads organizationId from the
// JWT and sets it on req, then next(). Isolates the route handler logic from
// the raw-SQL ownership check (which needs a live DB).
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

// Mock orchestrator — every method returns a plain object so handleOrchestratorResult
// has something to chew on. The methods are jest.fn() so tests can inspect calls.
const mockOrchestrator = {
  listStages: jest.fn(async () => [{ id: 's1', rounds: [] }]),
  configureStages: jest.fn(async () => []),
  startCompetition: jest.fn(async () => ({ result: { ok: true } })),
  startStage: jest.fn(async () => ({ result: { ok: true } })),
  startRound: jest.fn(async () => ({ result: { ok: true } })),
  pauseCompetition: jest.fn(async () => ({ result: { ok: true } })),
  resumeCompetition: jest.fn(async () => ({ result: { ok: true } })),
  endRound: jest.fn(async () => ({ result: { ok: true } })),
  startNextStage: jest.fn(async () => ({ result: { ok: true } })),
  endCompetition: jest.fn(async () => ({ result: { ok: true } })),
  submitAnswer: jest.fn(async () => ({ result: { ok: true }, emissions: [] })),
  processEmissions: jest.fn(),
  getRemainingSeconds: jest.fn(async () => 60),
  state: {
    getRoundTimer: jest.fn(async () => null),
    getRound3Cells: jest.fn(async () => ({})),
    getActivePlayers: jest.fn(async () => ({})),
  },
  getRound2TeamState: jest.fn(async () => null),
  r3Collaboration: null,
};

const { createGameRouter } = require('../routes/game');

// Real JWT tokens (same helper as production). organization_id flows into
// organizationId in the JWT payload.
const ADMIN_TOKEN = generateToken({ id: 1, username: 'admin', role: 'ORG_ADMIN', organization_id: 'org-admin' });
const JUDGE_TOKEN = generateToken({ id: 2, username: 'judge1', role: 'JUDGE', organization_id: 'org-admin' });
const PLAYER_TOKEN = generateToken({ id: 3, username: 'player1', role: 'PLAYER', organization_id: 'org-admin' });

function buildApp(repos) {
  const app = express();
  app.use(express.json());
  app.use('/api', createGameRouter(repos, mockOrchestrator));
  // SPA-style 404 fallback mirroring index.js, so unmatched /api paths
  // return the standard envelope instead of hanging.
  app.use((req, res) => res.status(404).json({ code: 404, message: 'Interface not found', data: null }));
  return app;
}

// Minimal repos — only the methods the game router reads. findByCompetitionAndStatus
// and findMemberTeam return null so the score/room-status handlers skip the
// heavy team/round branches.
function buildRepos() {
  return {
    competitions: {
      findById: jest.fn(async (id) => ({ id, name: 'Cup', status: 'IN_PROGRESS' })),
      findActiveRound: jest.fn(async () => null),
      // Added 2026-08-24: /my-state now also asks for a round in the
      // preparation phase (PENDING + a running prep timer) before
      // returning currentRound: null. Default: none — the "no active
      // round" test path stays valid.
      findPreparingRound: jest.fn(async () => null),
    },
    rounds: {
      findByCompetitionAndStatus: jest.fn(async () => null),
    },
    teams: {
      findByCompetitionWithMembers: jest.fn(async () => []),
      findMemberTeam: jest.fn(async () => null),
    },
    scores: {
      findPlayerScoresByCompetition: jest.fn(async () => []),
      findTeamScoresByCompetition: jest.fn(async () => []),
    },
    playerStates: {
      findPlayerAssignments: jest.fn(async () => []),
    },
  };
}

describe('game router — Phase 10 (reactivated)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/competitions/:id/stages answers 200 (router mounted on /competitions)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/competitions/comp-1/stages')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
  });

  // Written from fragments so a project-wide replace on "tournament" cannot
  // silently rewrite this legacy path into the live one.
  test('the legacy start path answers 404', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/tour' + 'naments/comp-1/start')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`);
    expect(res.status).toBe(404);
  });

  test('POST /api/competitions/:id/start forwards UUID as a string (no parseInt)', async () => {
    const app = buildApp(buildRepos());
    const UUID = '3f2a9c14-1234-4abc-9def-000000000001';
    const res = await request(app)
      .post(`/api/competitions/${UUID}/start`)
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`);
    expect(res.status).toBe(200);
    expect(mockOrchestrator.startCompetition).toHaveBeenCalledWith(UUID);
    const receivedId = mockOrchestrator.startCompetition.mock.calls[0][0];
    expect(typeof receivedId).toBe('string');
    expect(receivedId).toBe(UUID);
  });

  test('POST /api/competitions/:id/start rejects PLAYER (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions/comp-1/start')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('POST /api/competitions/:id/start accepts JUDGE (200)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/competitions/comp-1/start')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
  });

  test('POST /api/competitions/:id/rounds/:roundId/start forwards both UUIDs as strings', async () => {
    const app = buildApp(buildRepos());
    const COMP_ID = '3f2a9c14-1234-4abc-9def-000000000001';
    const ROUND_ID = '44b8ad25-2345-4bcd-9f00-111111111111';
    const res = await request(app)
      .post(`/api/competitions/${COMP_ID}/rounds/${ROUND_ID}/start`)
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`);
    expect(res.status).toBe(200);
    expect(mockOrchestrator.startRound).toHaveBeenCalledWith(COMP_ID, ROUND_ID);
    const [c, r] = mockOrchestrator.startRound.mock.calls[0];
    expect(typeof c).toBe('string');
    expect(typeof r).toBe('string');
  });

  test('GET /api/competitions/:id/room/status answers 200 for JUDGE', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/competitions/comp-1/room/status')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    // The response field was renamed: the legacy name must be gone. Written
    // from fragments so a replace on "tournament" cannot collapse the two
    // assertions onto the same key.
    expect(res.body.data).toHaveProperty('competitionId');
    expect(res.body.data).not.toHaveProperty('tour' + 'namentId');
  });

  test('GET /api/competitions/:id/my-state answers 200 for PLAYER (no active round)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/competitions/comp-1/my-state')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    // The response field was renamed tournamentStatus → competitionStatus.
    expect(res.body.data).toHaveProperty('competitionStatus');
    expect(res.body.data).not.toHaveProperty('tournamentStatus');
  });

  test('POST /api/submissions accepts PLAYER (no tenantGuard on this route)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/submissions')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .send({
        roundId: '3f2a9c14-1234-4abc-9def-000000000001',
        puzzleId: '44b8ad25-2345-4bcd-9f00-111111111111',
        submissionType: 'SINGLE_CELL',
        row: 0,
        col: 0,
        value: 5,
      });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
  });
});
