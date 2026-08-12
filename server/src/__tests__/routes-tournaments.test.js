// Unit tests for the tournament routes (POST/GET/PUT/DELETE /api/tournaments, etc.)
// We mount the tournament router on a tiny Express app with MOCKED repos so
// no real database is needed. Real JWT tokens are minted with the same
// `generateToken` helper the production app uses, so the auth middleware
// actually verifies them (not stubbed).

const express = require('express');
const request = require('supertest');
const { generateToken } = require('../middleware/auth');
const { createTournamentRouter } = require('../routes/tournaments');

// Mint real JWT tokens for the three roles. The auth middleware will verify
// these against config.JWT_SECRET — same path as production.
const ADMIN_TOKEN = generateToken({ id: 1, username: 'admin', role: 'ADMIN' });
const JUDGE_TOKEN = generateToken({ id: 2, username: 'judge', role: 'JUDGE' });
const PLAYER_TOKEN = generateToken({ id: 3, username: 'player1', role: 'PLAYER' });

// Mock repos factory. Only the methods the tournament router touches are
// implemented. Each test gets a fresh instance so call counters reset.
function buildRepos(overrides = {}) {
  const defaults = {
    tournaments: {
      create: async ({ name, description, scheduledTime, createdBy }) => ({
        id: 1, name, description, scheduled_time: scheduledTime || null,
        status: 'PENDING', created_by: createdBy,
      }),
      findAll: async () => [{ id: 1, name: 'Cup A', status: 'PENDING' }],
      findById: async (id) => {
        if (id === '999' || id === 999) return null;
        return { id: parseInt(id), name: 'Cup A', status: 'PENDING' };
      },
      deleteCascade: async (id) => ({ deleted: id }),
      update: async (id, { name, description, scheduledTime }) => ({
        id: parseInt(id), name: name || 'Cup A', description: description || '',
        scheduled_time: scheduledTime || null, status: 'PENDING',
      }),
    },
    rounds: {
      countByTournament: async () => 0,
      create: async ({ tournamentId, roundNumber, name, roundType, durationSeconds }) => ({
        id: 10, tournament_id: parseInt(tournamentId), round_number: roundNumber,
        name, round_type: roundType, duration_seconds: durationSeconds, status: 'NOT_STARTED',
      }),
      findWithPuzzles: async (tournamentId) => [],
      findById: async (roundId) => ({ id: parseInt(roundId), tournament_id: 1 }),
    },
    teams: {
      create: async ({ tournamentId, name }) => ({ id: 20, tournament_id: tournamentId, name }),
      findByTournamentWithMembers: async () => [],
      findByTournamentWithMemberCount: async () => [],
      getMembers: async () => [],
      getJudges: async () => [],
      memberExists: async () => false,
      findById: async () => ({ id: 20, tournament_id: 1 }),
      playerInOtherTeam: async () => false,
      addMember: async () => ({}),
      judgeAlreadyAssigned: async () => false,
      assignJudge: async () => ({}),
    },
    puzzles: {
      findByRoundSummary: async () => [],
    },
  };
  // Shallow-merge overrides per repo so a test can swap just one method.
  return {
    tournaments: { ...defaults.tournaments, ...overrides.tournaments },
    rounds: { ...defaults.rounds, ...overrides.rounds },
    teams: { ...defaults.teams, ...overrides.teams },
    puzzles: { ...defaults.puzzles, ...overrides.puzzles },
  };
}

function buildApp(repos) {
  const app = express();
  app.use(express.json());
  app.use('/api', createTournamentRouter(repos));
  return app;
}

describe('POST /api/tournaments (create tournament)', () => {
  test('ADMIN with valid body -> 200 + created tournament', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'New Cup', description: 'desc' });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.name).toBe('New Cup');
    expect(res.body.data.status).toBe('PENDING');
  });

  test('PLAYER is forbidden (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(40301);
  });

  test('JUDGE is forbidden (403)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  test('missing Authorization -> 401', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).post('/api/tournaments').send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  test('missing name is rejected by Zod (code 40001)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ description: 'no name' });
    expect(res.body.code).toBe(40001);
  });

  test('empty name is rejected by Zod (code 40001)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: '' });
    expect(res.body.code).toBe(40001);
  });
});

describe('GET /api/tournaments (list)', () => {
  test('any authenticated user gets the list', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/tournaments')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  test('unauthenticated -> 401', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app).get('/api/tournaments');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/tournaments/:id (detail)', () => {
  test('existing tournament returns 200 with rounds/teams/judges', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/tournaments/1')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
    expect(Array.isArray(res.body.data.rounds)).toBe(true);
    expect(Array.isArray(res.body.data.teams)).toBe(true);
    expect(Array.isArray(res.body.data.judges)).toBe(true);
  });

  test('unknown id returns code 40400', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .get('/api/tournaments/999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40400);
    expect(res.body.data).toBeNull();
  });
});

describe('POST /api/tournaments/:id/rounds (create round)', () => {
  test('ADMIN creates a round -> 200', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/tournaments/1/rounds')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Round 1', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 });
    expect(res.status).toBe(200);
    expect(res.body.data.round_type).toBe('ROUND1_NINE_ONE');
  });

  test('invalid roundType is rejected by Zod (code 40001)', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .post('/api/tournaments/1/rounds')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'R', roundType: 'HACKED', durationSeconds: 600 });
    expect(res.body.code).toBe(40001);
  });

  test('3 rounds already exist -> code 40010 (cap reached)', async () => {
    const app = buildApp(buildRepos({
      rounds: { countByTournament: async () => 3 },
    }));
    const res = await request(app)
      .post('/api/tournaments/1/rounds')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'R', roundType: 'ROUND1_NINE_ONE', durationSeconds: 600 });
    expect(res.body.code).toBe(40010);
  });
});

describe('DELETE /api/tournaments/:id', () => {
  test('ADMIN deletes a PENDING tournament -> 200', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .delete('/api/tournaments/1')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe('1');
  });

  test('IN_PROGRESS tournament cannot be deleted (code 40041)', async () => {
    const app = buildApp(buildRepos({
      tournaments: { findById: async () => ({ id: 1, name: 'X', status: 'IN_PROGRESS' }) },
    }));
    const res = await request(app)
      .delete('/api/tournaments/1')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40041);
  });

  test('unknown id returns code 40400', async () => {
    const app = buildApp(buildRepos());
    const res = await request(app)
      .delete('/api/tournaments/999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body.code).toBe(40400);
  });
});
