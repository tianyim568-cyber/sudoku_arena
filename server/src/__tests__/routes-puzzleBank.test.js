// Unit tests for the puzzleBank router (Phase 8 — reactivated).
//
// The router was commented out in index.js since migration 018. Phase 8 of the
// second migration chantier re-enables it. These tests pin two things:
//   1. The router is mounted and answers (no more 404 on /api/puzzle-bank).
//   2. A PLAYER is rejected on the generation route (ADMIN_ROLES gate).
//   3. A roundId UUID passed to /import-to-round reaches the service WITHOUT
//      being transformed into a number by parseInt. This is the silent-
//      corruption risk that Phase 8 flags — if a future change reintroduces
//      parseInt(roundId), this test catches it.
//
// We mock PuzzleBankService so no real file IO happens. The mock records the
// exact arguments it received, so the UUID-integrity assertion can inspect them.

const express = require('express');
const request = require('supertest');
const { generateToken } = require('../middleware/auth');

// Mock PuzzleBankService BEFORE the router imports it. The mock records every
// call so tests can assert on the arguments (not just the return value).
const mockService = {
  listPuzzles: jest.fn(() => ({ total: 0, puzzles: [], meta: {} })),
  getPuzzleDetail: jest.fn(() => null),
  getPuzzlePreview: jest.fn(() => null),
  generatePuzzles: jest.fn(() => ({ generated: 1, totalInBank: 1, newPuzzleIds: ['R1-1'] })),
  generateBulk: jest.fn(() => ({ r1: {}, r2: {}, r3: {}, totalGenerated: 0, totalInBank: 0 })),
  importToRound: jest.fn(async ({ roundId }) => ({ imported: 1, total: 1, _receivedRoundId: roundId })),
  deletePuzzle: jest.fn(async () => ({ deleted: true, id: 'R1-1' })),
  clearAll: jest.fn(async () => ({ deleted: 0 })),
};

jest.mock('../services/PuzzleBankService', () => {
  return jest.fn(() => mockService);
});

const { createPuzzleBankRouter } = require('../routes/puzzleBank');

// Real JWT tokens (same helper as production). organization_id flows into
// organizationId in the JWT payload.
const ADMIN_TOKEN = generateToken({ id: 1, username: 'admin', role: 'ORG_ADMIN', organization_id: 'org-admin' });
const PLAYER_TOKEN = generateToken({ id: 3, username: 'player1', role: 'PLAYER', organization_id: 'org-admin' });

function buildApp(repos) {
  const app = express();
  app.use(express.json());
  app.use('/api', createPuzzleBankRouter(repos));
  return app;
}

// Minimal repos — the router only uses repos.rounds.findById for import-to-round.
function buildRepos() {
  return {
    rounds: {
      findById: async (roundId) => ({ id: roundId, stage_id: 'stage-1', round_type: 'ROUND1_NINE_ONE' }),
    },
    puzzles: {
      countByRound: async () => 0,
    },
  };
}

describe('puzzleBank router — Phase 8 (reactivated)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/puzzle-bank answers 200 (router is mounted)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/puzzle-bank')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(mockService.listPuzzles).toHaveBeenCalled();
  });

  test('POST /api/puzzle-bank/generate accepts ORG_ADMIN', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/puzzle-bank/generate')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ roundType: 'ROUND1_NINE_ONE', count: 1, teamsCount: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.generated).toBe(1);
  });

  // BUG-04 fix: INDIVIDUAL_STANDARD (solo sudoku round) must be accepted by
  // the generate route. Before the fix, only the three team roundTypes were
  // in the Zod enum, so a solo round could not be populated from the UI —
  // the admin was stuck at "no puzzles" with no way out. This test pins the
  // new enum value at the router boundary.
  test('POST /api/puzzle-bank/generate accepts INDIVIDUAL_STANDARD with count', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/puzzle-bank/generate')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ roundType: 'INDIVIDUAL_STANDARD', count: 8 });
    expect(res.status).toBe(200);
    // The service received the request with the count forwarded verbatim.
    expect(mockService.generatePuzzles).toHaveBeenCalledWith(
      expect.objectContaining({ roundType: 'INDIVIDUAL_STANDARD', count: 8 })
    );
  });

  test('POST /api/puzzle-bank/generate rejects PLAYER (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/puzzle-bank/generate')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .send({ roundType: 'ROUND1_NINE_ONE', count: 1, teamsCount: 1 });
    expect(res.status).toBe(403);
    expect(mockService.generatePuzzles).not.toHaveBeenCalled();
  });

  // The silent-corruption guard: a UUID roundId must reach the service AS A
  // STRING, not as parseInt('3f2a...') === 3. Phase 8 flagged 4 parseInt
  // occurrences in PuzzleBankService that will fail on real UUIDs; this test
  // pins the contract at the router boundary so we notice if the service is
  // "fixed" without updating the router, or vice versa.
  test('POST /api/puzzle-bank/import-to-round forwards UUID roundId as a string', async () => {
    const app = buildApp(buildRepos());
    const UUID = '3f2a9c14-1234-4abc-9def-000000000001';
    const res = await request(app)
      .post('/api/puzzle-bank/import-to-round')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ roundId: UUID });
    expect(res.status).toBe(200);
    // The service received the UUID verbatim, not as a number.
    expect(mockService.importToRound).toHaveBeenCalledWith(
      expect.objectContaining({ roundId: UUID })
    );
    // And NOT as a number — this is the parseInt corruption guard.
    const receivedRoundId = mockService.importToRound.mock.calls[0][0].roundId;
    expect(typeof receivedRoundId).toBe('string');
    expect(receivedRoundId).toBe(UUID);
  });

  test('DELETE /api/puzzle-bank/:id rejects PLAYER (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .delete('/api/puzzle-bank/R1-1')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(403);
    expect(mockService.deletePuzzle).not.toHaveBeenCalled();
  });
});
