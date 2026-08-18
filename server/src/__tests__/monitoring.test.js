// Unit tests for the monitoring router (Judge Participant Monitoring feature).
//
// Tests cover:
//   1. Authorization: only JUDGE role with assignment can access
//   2. Successful retrieval of participants with online/offline status
//   3. Correct summary counts (total, online, offline)
//   4. State repository enrichments (getActivePlayers, getStalePlayers)
//   5. PresenceService behavior (sweep, offline event emission)
//   6. Player monitoring endpoint (player puzzle state)

const express = require('express');
const request = require('supertest');
const { generateToken } = require('../middleware/auth');

// Mock prisma for monitoring endpoints
const mockPrisma = {
  competition_judges: {
    findFirst: jest.fn(),
  },
  players: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  rounds: {
    findFirst: jest.fn(),
  },
  player_round_sessions: {
    findUnique: jest.fn(),
  },
  puzzle_answers: {
    findMany: jest.fn(),
  },
};

jest.mock('../db/prisma', () => ({
  getPrisma: () => mockPrisma,
}));

// Mock tenantGuard
jest.mock('../middleware/tenantGuard', () => {
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
  return { tenantGuard: mockTenantGuard };
});

// Mock repositories
const mockRepos = {};

// Mock state repository
const mockState = {
  getActivePlayers: jest.fn(),
};

const { createMonitoringRouter } = require('../routes/monitoring');

// JWT tokens for different roles
const JUDGE_TOKEN = generateToken({ id: 'user-2', username: 'judge1', role: 'JUDGE', organization_id: 'org-admin' });
const PLAYER_TOKEN = generateToken({ id: 'user-3', username: 'player1', role: 'PLAYER', organization_id: 'org-admin' });
const ADMIN_TOKEN = generateToken({ id: 'user-1', username: 'admin', role: 'ORG_ADMIN', organization_id: 'org-admin' });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', createMonitoringRouter(mockRepos, mockState));
  app.use((req, res) => res.status(404).json({ code: 404, message: 'Interface not found', data: null }));
  return app;
}

describe('Monitoring Router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/competitions/:competitionId/monitoring/participants', () => {
    const competitionId = 'comp-uuid-123';

    test('rejects unauthenticated requests (401)', async () => {
      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/participants`)
        .expect(401);

      expect(res.body.code).toBe(40101);
    });

    test('rejects PLAYER role (403) - not a judge', async () => {
      mockPrisma.competition_judges.findFirst.mockResolvedValue(null);

      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/participants`)
        .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
        .expect(403);

      expect(res.body.code).toBe(403);
      expect(res.body.message).toContain('Access denied');
    });

    test('rejects JUDGE not assigned to competition (403)', async () => {
      mockPrisma.competition_judges.findFirst.mockResolvedValue(null);

      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/participants`)
        .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
        .expect(403);

      expect(res.body.code).toBe(403);
      expect(mockPrisma.competition_judges.findFirst).toHaveBeenCalledWith({
        where: {
          competition_id: competitionId,
          user_id: 'user-2'
        }
      });
    });

    test('allows assigned JUDGE to retrieve participants with online status', async () => {
      mockPrisma.competition_judges.findFirst.mockResolvedValue({
        competition_id: competitionId,
        user_id: 'user-2'
      });
      mockPrisma.players.findMany.mockResolvedValue([
        {
          id: 'p1',
          name: 'Alice',
          school: 'School A',
          user_id: 'user-alice',
          team_members: [{ team_id: 't1', teams: { name: 'Team Alpha' } }],
        },
        {
          id: 'p2',
          name: 'Bob',
          school: null,
          user_id: 'user-bob',
          team_members: [],
        },
      ]);
      mockState.getActivePlayers.mockResolvedValue({
        'user-alice': { socketId: 'sock-1', lastHeartbeatAt: Date.now() },
      });

      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/participants`)
        .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
        .expect(200);

      expect(res.body.code).toBe(200);
      expect(res.body.data.competitionId).toBe(competitionId);
      expect(res.body.data.participants).toHaveLength(2);

      // Alice is online
      expect(res.body.data.participants[0]).toMatchObject({
        id: 'p1',
        name: 'Alice',
        school: 'School A',
        teamId: 't1',
        teamName: 'Team Alpha',
        online: true,
      });
      expect(res.body.data.participants[0].lastHeartbeatAt).toBeDefined();

      // Bob is offline
      expect(res.body.data.participants[1]).toMatchObject({
        id: 'p2',
        name: 'Bob',
        school: null,
        teamId: null,
        teamName: null,
        online: false,
        lastHeartbeatAt: null,
      });

      // Summary counts
      expect(res.body.data.summary).toEqual({
        total: 2,
        online: 1,
        offline: 1,
      });
    });

    test('allows ORG_ADMIN to access monitoring', async () => {
      mockPrisma.competition_judges.findFirst.mockResolvedValue({
        competition_id: competitionId,
        user_id: 'user-1'
      });
      mockPrisma.players.findMany.mockResolvedValue([]);
      mockState.getActivePlayers.mockResolvedValue({});

      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/participants`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .expect(200);

      expect(res.body.data.participants).toHaveLength(0);
      expect(res.body.data.summary).toEqual({ total: 0, online: 0, offline: 0 });
    });

    test('returns empty list when no participants exist', async () => {
      mockPrisma.competition_judges.findFirst.mockResolvedValue({
        competition_id: competitionId,
        user_id: 'user-2'
      });
      mockPrisma.players.findMany.mockResolvedValue([]);
      mockState.getActivePlayers.mockResolvedValue({});

      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/participants`)
        .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
        .expect(200);

      expect(res.body.data.participants).toHaveLength(0);
      expect(res.body.data.summary.total).toBe(0);
    });

    test('handles repository errors gracefully (500)', async () => {
      mockPrisma.competition_judges.findFirst.mockRejectedValue(new Error('DB error'));

      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/participants`)
        .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
        .expect(500);

      expect(res.body.code).toBe(500);
      expect(res.body.message).toBe('Internal server error');
    });
  });

  describe('GET /api/competitions/:competitionId/monitoring/player/:playerId', () => {
    const competitionId = 'comp-uuid-123';
    const playerId = 'player-uuid-456';

    test('rejects unauthenticated requests (401)', async () => {
      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
        .expect(401);

      expect(res.body.code).toBe(40101);
    });

    test('rejects PLAYER role (403) - not a judge', async () => {
      mockPrisma.competition_judges.findFirst.mockResolvedValue(null);

      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
        .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
        .expect(403);

      expect(res.body.code).toBe(403);
    });

    test('rejects JUDGE not assigned to competition (403)', async () => {
      mockPrisma.competition_judges.findFirst.mockResolvedValue(null);

      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
        .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
        .expect(403);

      expect(res.body.code).toBe(403);
    });

    test('returns 404 when player not found', async () => {
      mockPrisma.competition_judges.findFirst.mockResolvedValue({
        competition_id: competitionId,
        user_id: 'user-2'
      });
      mockPrisma.players.findUnique.mockResolvedValue(null);

      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
        .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
        .expect(404);

      expect(res.body.code).toBe(404);
      expect(res.body.message).toContain('Player not found');
    });

    test('returns 404 when player belongs to different competition', async () => {
      mockPrisma.competition_judges.findFirst.mockResolvedValue({
        competition_id: competitionId,
        user_id: 'user-2'
      });
      mockPrisma.players.findUnique.mockResolvedValue({
        id: playerId,
        name: 'Alice',
        competition_id: 'other-comp-id',
      });

      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
        .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
        .expect(404);

      expect(res.body.code).toBe(404);
    });

    test('returns empty puzzles when no active round', async () => {
      mockPrisma.competition_judges.findFirst.mockResolvedValue({
        competition_id: competitionId,
        user_id: 'user-2'
      });
      mockPrisma.players.findUnique.mockResolvedValue({
        id: playerId,
        name: 'Alice',
        competition_id: competitionId,
      });
      mockPrisma.rounds.findFirst.mockResolvedValue(null);

      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
        .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
        .expect(200);

      expect(res.body.code).toBe(200);
      expect(res.body.data).toEqual({
        playerId,
        playerName: 'Alice',
        roundId: null,
        sessionStatus: null,
        puzzles: [],
      });
    });

    test('returns empty puzzles when no session exists', async () => {
      mockPrisma.competition_judges.findFirst.mockResolvedValue({
        competition_id: competitionId,
        user_id: 'user-2'
      });
      mockPrisma.players.findUnique.mockResolvedValue({
        id: playerId,
        name: 'Alice',
        competition_id: competitionId,
      });
      mockPrisma.rounds.findFirst.mockResolvedValue({
        id: 'round-1',
        name: 'Round 1',
        status: 'RUNNING',
      });
      mockPrisma.player_round_sessions.findUnique.mockResolvedValue(null);

      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
        .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
        .expect(200);

      expect(res.body.data).toEqual({
        playerId,
        playerName: 'Alice',
        roundId: 'round-1',
        sessionStatus: null,
        puzzles: [],
      });
    });

    test('returns player puzzle state with grid and progress', async () => {
      mockPrisma.competition_judges.findFirst.mockResolvedValue({
        competition_id: competitionId,
        user_id: 'user-2'
      });
      mockPrisma.players.findUnique.mockResolvedValue({
        id: playerId,
        name: 'Alice',
        competition_id: competitionId,
      });
      mockPrisma.rounds.findFirst.mockResolvedValue({
        id: 'round-1',
        name: 'Round 1',
        status: 'RUNNING',
      });
      mockPrisma.player_round_sessions.findUnique.mockResolvedValue({
        id: 'session-1',
        round_id: 'round-1',
        participant_id: playerId,
        status: 'PLAYING',
      });
      mockPrisma.puzzle_answers.findMany.mockResolvedValue([
        {
          id: 'answer-1',
          session_id: 'session-1',
          puzzle_id: 'puzzle-1',
          current_grid: [[1, 0], [0, 2]],
          correct_cells: 1,
          total_empty_cells: 2,
          progress_percentage: '50.00',
        },
        {
          id: 'answer-2',
          session_id: 'session-1',
          puzzle_id: 'puzzle-2',
          current_grid: [[3, 4], [5, 6]],
          correct_cells: 4,
          total_empty_cells: 4,
          progress_percentage: '100.00',
        },
      ]);

      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
        .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
        .expect(200);

      expect(res.body.code).toBe(200);
      expect(res.body.data.playerId).toBe(playerId);
      expect(res.body.data.playerName).toBe('Alice');
      expect(res.body.data.roundId).toBe('round-1');
      expect(res.body.data.sessionStatus).toBe('PLAYING');
      expect(res.body.data.puzzles).toHaveLength(2);
      expect(res.body.data.puzzles[0]).toEqual({
        puzzleId: 'puzzle-1',
        currentGrid: [[1, 0], [0, 2]],
        correctCells: 1,
        totalEmptyCells: 2,
        progressPercentage: 50,
      });
      expect(res.body.data.puzzles[1]).toEqual({
        puzzleId: 'puzzle-2',
        currentGrid: [[3, 4], [5, 6]],
        correctCells: 4,
        totalEmptyCells: 4,
        progressPercentage: 100,
      });
    });

    test('handles repository errors gracefully (500)', async () => {
      mockPrisma.competition_judges.findFirst.mockRejectedValue(new Error('DB error'));

      const app = buildApp();
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
        .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
        .expect(500);

      expect(res.body.code).toBe(500);
      expect(res.body.message).toBe('Internal server error');
    });
  });
});

describe('State Repository Enrichments', () => {
  let MemoryStateRepository;
  let state;

  beforeAll(() => {
    MemoryStateRepository = require('../state/MemoryStateRepository');
  });

  beforeEach(() => {
    state = new MemoryStateRepository();
  });

  describe('setActivePlayer', () => {
    test('stores socketId and lastHeartbeatAt', async () => {
      const before = Date.now();
      await state.setActivePlayer('comp1', 'user1', 'sock1');
      const after = Date.now();

      const players = await state.getActivePlayers('comp1');
      expect(players['user1']).toBeDefined();
      expect(players['user1'].socketId).toBe('sock1');
      expect(players['user1'].lastHeartbeatAt).toBeGreaterThanOrEqual(before);
      expect(players['user1'].lastHeartbeatAt).toBeLessThanOrEqual(after);
    });
  });

  describe('getActivePlayers', () => {
    test('returns enriched format with socketId and lastHeartbeatAt', async () => {
      await state.setActivePlayer('comp1', 'user1', 'sock1');
      await state.setActivePlayer('comp1', 'user2', 'sock2');

      const players = await state.getActivePlayers('comp1');
      expect(players['user1']).toHaveProperty('socketId');
      expect(players['user1']).toHaveProperty('lastHeartbeatAt');
      expect(players['user2']).toHaveProperty('socketId');
      expect(players['user2']).toHaveProperty('lastHeartbeatAt');
    });

    test('returns empty object for non-existent competition', async () => {
      const players = await state.getActivePlayers('comp999');
      expect(players).toEqual({});
    });
  });

  describe('getStalePlayers', () => {
    test('returns players whose heartbeat exceeds TTL', async () => {
      await state.setActivePlayer('comp1', 'user1', 'sock1');
      await state.setActivePlayer('comp1', 'user2', 'sock2');

      // Manually set user1 to old timestamp
      state._activePlayers.get('comp1').get('user1').lastHeartbeatAt = Date.now() - 5000;

      const stale = await state.getStalePlayers('comp1', 2000); // 2 second TTL
      expect(stale).toHaveLength(1);
      expect(stale[0].userId).toBe('user1');
      expect(stale[0].socketId).toBe('sock1');
    });

    test('returns empty array when no players are stale', async () => {
      await state.setActivePlayer('comp1', 'user1', 'sock1');
      await state.setActivePlayer('comp1', 'user2', 'sock2');

      const stale = await state.getStalePlayers('comp1', 60000); // 60 second TTL
      expect(stale).toHaveLength(0);
    });

    test('returns empty array for non-existent competition', async () => {
      const stale = await state.getStalePlayers('comp999', 2000);
      expect(stale).toHaveLength(0);
    });
  });
});

describe('PresenceService', () => {
  let PresenceService;
  let EmissionBus;
  let MemoryStateRepository;
  let presenceService;
  let state;
  let bus;

  beforeAll(() => {
    PresenceService = require('../services/PresenceService');
    EmissionBus = require('../ws/EmissionBus');
    MemoryStateRepository = require('../state/MemoryStateRepository');
  });

  beforeEach(() => {
    state = new MemoryStateRepository();
    bus = new EmissionBus();
    presenceService = new PresenceService(state, bus);
  });

  afterEach(() => {
    presenceService.stop();
  });

  describe('addCompetition / removeCompetition', () => {
    test('tracks monitored competitions', () => {
      presenceService.addCompetition('comp1');
      expect(presenceService.monitoredCompetitions.has('comp1')).toBe(true);

      presenceService.removeCompetition('comp1');
      expect(presenceService.monitoredCompetitions.has('comp1')).toBe(false);
    });
  });

  describe('sweep', () => {
    test('removes stale players and emits offline events', async () => {
      const emissions = [];
      bus.on('immediate', (e) => emissions.push(e));

      presenceService.addCompetition('comp1');

      // Add two players, one stale
      await state.setActivePlayer('comp1', 'user1', 'sock1');
      await state.setActivePlayer('comp1', 'user2', 'sock2');

      // Manually make user1 stale (5 seconds old, 2 second TTL)
      state._activePlayers.get('comp1').get('user1').lastHeartbeatAt = Date.now() - 5000;

      // Sweep with 2 second TTL
      await presenceService.sweep(2000);

      // user1 should be removed
      const remaining = await state.getActivePlayers('comp1');
      expect(remaining['user1']).toBeUndefined();
      expect(remaining['user2']).toBeDefined();

      // Should emit offline event for user1
      expect(emissions).toHaveLength(1);
      expect(emissions[0]).toMatchObject({
        target: 'competition',
        targetId: 'comp1',
        event: 'PARTICIPANT_STATUS_CHANGE',
      });
      expect(emissions[0].payload).toMatchObject({
        userId: 'user1',
        status: 'offline',
        socketId: 'sock1',
      });
    });

    test('does not emit events for fresh players', async () => {
      const emissions = [];
      bus.on('immediate', (e) => emissions.push(e));

      presenceService.addCompetition('comp1');
      await state.setActivePlayer('comp1', 'user1', 'sock1');

      await presenceService.sweep(60000); // 60 second TTL

      expect(emissions).toHaveLength(0);
      const remaining = await state.getActivePlayers('comp1');
      expect(remaining['user1']).toBeDefined();
    });

    test('handles multiple competitions', async () => {
      const emissions = [];
      bus.on('immediate', (e) => emissions.push(e));

      presenceService.addCompetition('comp1');
      presenceService.addCompetition('comp2');

      await state.setActivePlayer('comp1', 'user1', 'sock1');
      await state.setActivePlayer('comp2', 'user2', 'sock2');

      // Make both stale
      state._activePlayers.get('comp1').get('user1').lastHeartbeatAt = Date.now() - 5000;
      state._activePlayers.get('comp2').get('user2').lastHeartbeatAt = Date.now() - 5000;

      await presenceService.sweep(2000);

      expect(emissions).toHaveLength(2);
      expect(emissions.map(e => e.payload.userId).sort()).toEqual(['user1', 'user2']);
    });
  });

  describe('start / stop', () => {
    test('starts periodic sweep', async () => {
      presenceService.addCompetition('comp1');
      await state.setActivePlayer('comp1', 'user1', 'sock1');

      // Make stale
      state._activePlayers.get('comp1').get('user1').lastHeartbeatAt = Date.now() - 5000;

      presenceService.start(2000, 2000); // 2 second interval, 2 second TTL

      // Wait for one sweep cycle
      await new Promise(resolve => setTimeout(resolve, 2500));

      const remaining = await state.getActivePlayers('comp1');
      expect(remaining['user1']).toBeUndefined();
    });

    test('stops periodic sweep', async () => {
      presenceService.addCompetition('comp1');
      await state.setActivePlayer('comp1', 'user1', 'sock1');

      presenceService.start(2000);
      presenceService.stop();

      // Make stale after stopping
      state._activePlayers.get('comp1').get('user1').lastHeartbeatAt = Date.now() - 5000;

      // Wait for what would have been a sweep cycle
      await new Promise(resolve => setTimeout(resolve, 2500));

      const remaining = await state.getActivePlayers('comp1');
      expect(remaining['user1']).toBeDefined(); // Should still be there
    });
  });
});
