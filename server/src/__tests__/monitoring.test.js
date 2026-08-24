// Unit tests for the monitoring router (Judge Participant Monitoring feature).
//
// Tests cover:
//   1. Authorization: only JUDGE role with assignment can access
//   2. Successful retrieval of participants with online/offline status
//   3. Correct summary counts (total, online, offline)
//   4. State repository enrichments (refreshHeartbeat, getStalePlayers)
//   5. PresenceService behavior (sweep, offline event emission)

const express = require('express');
const request = require('supertest');
const { generateToken } = require('../middleware/auth');

// Mock prisma for player monitoring endpoint
const mockPrisma = {
  players: {
    findUnique: jest.fn(),
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

// Mock tenantGuard (same pattern as routes-game.test.js)
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

// Mock repositories
const mockRepos = {
  participants: {
    findByCompetition: jest.fn(),
  },
  teams: {
    judgeAlreadyAssigned: jest.fn(),
    getJudges: jest.fn(),
  },
  rounds: {
    findByCompetitionAndStatus: jest.fn(),
  },
};

// Mock state repository
const mockState = {
  getActivePlayers: jest.fn(),
};

const { createMonitoringRouter } = require('../routes/monitoring');

// JWT tokens for different roles
const JUDGE_TOKEN = generateToken({ id: 2, username: 'judge1', role: 'JUDGE', organization_id: 'org-admin' });
const PLAYER_TOKEN = generateToken({ id: 3, username: 'player1', role: 'PLAYER', organization_id: 'org-admin' });
const ADMIN_TOKEN = generateToken({ id: 1, username: 'admin', role: 'ORG_ADMIN', organization_id: 'org-admin' });

function buildApp(repos, state) {
  const app = express();
  app.use(express.json());
  app.use('/api', createMonitoringRouter(repos, state));
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
      const app = buildApp(mockRepos, mockState);
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/participants`)
        .expect(401);

      expect(res.body.code).toBe(40101);
    });

    test('rejects PLAYER role (403)', async () => {
      mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(false);

      const app = buildApp(mockRepos, mockState);
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/participants`)
        .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
        .expect(403);

      expect(res.body.code).toBe(403);
      expect(res.body.message).toContain('Access denied');
    });

    test('rejects JUDGE not assigned to competition (403)', async () => {
      mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(false);

      const app = buildApp(mockRepos, mockState);
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/participants`)
        .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
        .expect(403);

      expect(res.body.code).toBe(403);
      expect(mockRepos.teams.judgeAlreadyAssigned).toHaveBeenCalledWith(competitionId, 2);
    });

    test('allows assigned JUDGE to retrieve participants with online status', async () => {
      mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(true);
      mockRepos.participants.findByCompetition.mockResolvedValue([
        {
          id: 'p1',
          name: 'Alice',
          school: 'School A',
          team_members: [{ team_id: 't1' }],
          team_name: 'Team Alpha',
          user_id: 'user-1',
        },
        {
          id: 'p2',
          name: 'Bob',
          school: null,
          team_members: [],
          team_name: null,
          user_id: 'user-2',
        },
      ]);
      mockState.getActivePlayers.mockResolvedValue({
        'user-1': { socketId: 'sock-1', lastHeartbeatAt: Date.now() },
      });

      const app = buildApp(mockRepos, mockState);
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

    // F65 (2026-08-24): the judge monitoring payload was enriched with
    // score, age and category so the judge panel can show them without a
    // second fetch. This test pins the new fields end-to-end.
    test('F65: exposes score, age and category alongside identity + presence', async () => {
      mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(true);
      const CAT = { id: 'cat-u12', name: 'U12', min_age: 8, max_age: 12 };
      mockRepos.participants.findByCompetition.mockResolvedValue([
        {
          id: 'p1',
          name: 'Alice',
          school: 'School A',
          team_members: [{ team_id: 't1' }],
          team_name: 'Team Alpha',
          user_id: 'user-1',
          // Fields the repo now surfaces after the F65 fix.
          age: 10,
          categoryObj: CAT,
          totalScore: 42,
        },
        {
          id: 'p2',
          name: 'Bob',
          school: null,
          team_members: [],
          team_name: null,
          user_id: 'user-2',
          // A participant without a category or age is still valid (the
          // Excel import allows both to be missing) — check nulls flow.
          age: null,
          categoryObj: null,
          totalScore: 0,
        },
      ]);
      mockState.getActivePlayers.mockResolvedValue({});

      const app = buildApp(mockRepos, mockState);
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/participants`)
        .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
        .expect(200);

      expect(res.body.data.participants[0]).toMatchObject({
        id: 'p1', name: 'Alice', age: 10, score: 42, category: CAT,
      });
      expect(res.body.data.participants[1]).toMatchObject({
        id: 'p2', name: 'Bob', age: null, score: 0, category: null,
      });
    });

    test('allows ORG_ADMIN to access monitoring', async () => {
      mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(true);
      mockRepos.participants.findByCompetition.mockResolvedValue([]);
      mockState.getActivePlayers.mockResolvedValue({});

      const app = buildApp(mockRepos, mockState);
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/participants`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .expect(200);

      expect(res.body.data.participants).toHaveLength(0);
      expect(res.body.data.summary).toEqual({ total: 0, online: 0, offline: 0 });
    });

    test('returns empty list when no participants exist', async () => {
      mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(true);
      mockRepos.participants.findByCompetition.mockResolvedValue([]);
      mockState.getActivePlayers.mockResolvedValue({});

      const app = buildApp(mockRepos, mockState);
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/participants`)
        .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
        .expect(200);

      expect(res.body.data.participants).toHaveLength(0);
      expect(res.body.data.summary.total).toBe(0);
    });

    test('handles repository errors gracefully (500)', async () => {
      mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(true);
      mockRepos.participants.findByCompetition.mockRejectedValue(new Error('DB error'));

      const app = buildApp(mockRepos, mockState);
      const res = await request(app)
        .get(`/api/competitions/${competitionId}/monitoring/participants`)
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

  describe('refreshHeartbeat', () => {
    test('updates lastHeartbeatAt without changing socketId', async () => {
      await state.setActivePlayer('comp1', 'user1', 'sock1');
      const initial = await state.getActivePlayers('comp1');
      const initialTime = initial['user1'].lastHeartbeatAt;

      // Wait a bit to ensure timestamp advances
      await new Promise(resolve => setTimeout(resolve, 10));

      await state.refreshHeartbeat('comp1', 'user1');
      const updated = await state.getActivePlayers('comp1');

      expect(updated['user1'].socketId).toBe('sock1');
      expect(updated['user1'].lastHeartbeatAt).toBeGreaterThan(initialTime);
    });

    test('does nothing if player is not active', async () => {
      await state.refreshHeartbeat('comp1', 'user999');
      const players = await state.getActivePlayers('comp1');
      expect(players).toEqual({});
    });
  });

  describe('getStalePlayers', () => {
    test('returns players whose heartbeat exceeds TTL', async () => {
      const oldTime = Date.now() - 5000; // 5 seconds ago
      const recentTime = Date.now();

      await state.setActivePlayer('comp1', 'user1', 'sock1');
      await state.setActivePlayer('comp1', 'user2', 'sock2');

      // Manually set user1 to old timestamp
      state._activePlayers.get('comp1').get('user1').lastHeartbeatAt = oldTime;

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

describe('PARTICIPANT_LIST_STATE_UPDATE (judge-only WebSocket event)', () => {
  const SocketManager = require('../ws/SocketManager');
  const EmissionBus = require('../ws/EmissionBus');

  let socketManager, mockIo, mockRepos, mockOrchestrator, mockBus, mockState;

  beforeEach(() => {
    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      use: jest.fn(),
      on: jest.fn()
    };

    mockState = {
      getActivePlayers: jest.fn().mockResolvedValue({
        'player-user-1': { socketId: 'sock1', lastHeartbeatAt: 1000 },
      }),
      getStalePlayers: jest.fn().mockResolvedValue([]),
      removeActivePlayer: jest.fn().mockResolvedValue()
    };

    mockRepos = {
      teams: {
        getJudges: jest.fn().mockResolvedValue([
          { user_id: 'judge-1', username: 'judge1' },
          { user_id: 'judge-2', username: 'judge2' }
        ]),
        findMemberTeam: jest.fn().mockResolvedValue(null)
      },
      participants: {
        findByCompetition: jest.fn().mockResolvedValue([
          {
            id: 'p1',
            name: 'Player One',
            school: 'School A',
            user_id: 'player-user-1',
            team_members: [{ team_id: 't1' }],
            team_name: 'Team Alpha'
          },
          {
            id: 'p2',
            name: 'Player Two',
            school: null,
            user_id: 'player-user-2',
            team_members: [],
            team_name: null
          }
        ])
      }
    };

    mockOrchestrator = { state: mockState };
    mockBus = new EmissionBus();

    socketManager = new SocketManager(mockIo, mockRepos, mockOrchestrator, mockBus, null);
  });

  test('emits PARTICIPANT_LIST_STATE_UPDATE to each judge user room', async () => {
    await socketManager._emitParticipantListUpdate('comp-1');

    // Should query judges
    expect(mockRepos.teams.getJudges).toHaveBeenCalledWith('comp-1');

    // Should query participants
    expect(mockRepos.participants.findByCompetition).toHaveBeenCalledWith('comp-1');

    // Should get active players
    expect(mockState.getActivePlayers).toHaveBeenCalledWith('comp-1');

    // Should emit to each judge's user room
    expect(mockIo.to).toHaveBeenCalledTimes(2);
    expect(mockIo.to).toHaveBeenCalledWith('user_judge-1');
    expect(mockIo.to).toHaveBeenCalledWith('user_judge-2');

    // Should emit 'event' with PARTICIPANT_LIST_STATE_UPDATE
    expect(mockIo.emit).toHaveBeenCalledTimes(2);

    const msg1 = mockIo.emit.mock.calls[0][1];
    expect(msg1.type).toBe('PARTICIPANT_LIST_STATE_UPDATE');
    expect(msg1.competitionId).toBe('comp-1');

    // Verify participant list shape
    expect(msg1.payload.participants).toHaveLength(2);
    expect(msg1.payload.participants[0]).toMatchObject({
      id: 'p1',
      name: 'Player One',
      school: 'School A',
      teamId: 't1',
      teamName: 'Team Alpha',
      online: true,
      lastHeartbeatAt: 1000
    });
    expect(msg1.payload.participants[1]).toMatchObject({
      id: 'p2',
      name: 'Player Two',
      school: null,
      teamId: null,
      teamName: null,
      online: false,
      lastHeartbeatAt: null
    });

    // Verify summary
    expect(msg1.payload.summary).toEqual({ total: 2, online: 1, offline: 1 });
  });

  test('does not emit when no judges exist', async () => {
    mockRepos.teams.getJudges.mockResolvedValue([]);

    await socketManager._emitParticipantListUpdate('comp-1');

    expect(mockIo.to).not.toHaveBeenCalled();
    expect(mockIo.emit).not.toHaveBeenCalled();
  });

  test('handles errors gracefully without throwing', async () => {
    mockRepos.teams.getJudges.mockRejectedValue(new Error('DB error'));

    // Should not throw
    await expect(
      socketManager._emitParticipantListUpdate('comp-1')
    ).resolves.not.toThrow();

    expect(mockIo.to).not.toHaveBeenCalled();
    expect(mockIo.emit).not.toHaveBeenCalled();
  });

  test('is triggered by _routeEmission on PARTICIPANT_STATUS_CHANGE', async () => {
    // Spy on _emitParticipantListUpdate
    const spy = jest.spyOn(socketManager, '_emitParticipantListUpdate');

    // Simulate a bus emission for PARTICIPANT_STATUS_CHANGE
    mockBus.emitImmediate({
      target: 'competition',
      targetId: 'comp-1',
      event: 'PARTICIPANT_STATUS_CHANGE',
      payload: {
        competitionId: 'comp-1',
        userId: 'user-1',
        status: 'offline',
        socketId: 'sock1'
      }
    });

    // Wait for fire-and-forget to execute
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(spy).toHaveBeenCalledWith('comp-1');
  });
});

describe('GET /api/competitions/:competitionId/monitoring/player/:playerId', () => {
  const competitionId = 'comp-uuid-123';
  const playerId = 'player-uuid-456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects unauthenticated requests (401)', async () => {
    const app = buildApp(mockRepos, mockState);
    const res = await request(app)
      .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
      .expect(401);

    expect(res.body.code).toBe(40101);
  });

  test('rejects PLAYER role (403)', async () => {
    mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(false);

    const app = buildApp(mockRepos, mockState);
    const res = await request(app)
      .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
      .expect(403);

    expect(res.body.code).toBe(403);
  });

  test('rejects JUDGE not assigned to competition (403)', async () => {
    mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(false);

    const app = buildApp(mockRepos, mockState);
    const res = await request(app)
      .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
      .expect(403);

    expect(res.body.code).toBe(403);
  });

  test('returns 404 when player not found', async () => {
    mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(true);
    mockPrisma.players.findUnique.mockResolvedValue(null);

    const app = buildApp(mockRepos, mockState);
    const res = await request(app)
      .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
      .expect(404);

    expect(res.body.code).toBe(404);
    expect(res.body.message).toContain('Player not found');
  });

  test('returns 404 when player belongs to different competition', async () => {
    mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(true);
    mockPrisma.players.findUnique.mockResolvedValue({
      id: playerId,
      name: 'Alice',
      competition_id: 'other-comp-id',
    });

    const app = buildApp(mockRepos, mockState);
    const res = await request(app)
      .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
      .expect(404);

    expect(res.body.code).toBe(404);
  });

  test('returns empty puzzles when no active round', async () => {
    mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(true);
    mockPrisma.players.findUnique.mockResolvedValue({
      id: playerId,
      name: 'Alice',
      competition_id: competitionId,
    });
    mockRepos.rounds.findByCompetitionAndStatus.mockResolvedValue(null);

    const app = buildApp(mockRepos, mockState);
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
    mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(true);
    mockPrisma.players.findUnique.mockResolvedValue({
      id: playerId,
      name: 'Alice',
      competition_id: competitionId,
    });
    mockRepos.rounds.findByCompetitionAndStatus.mockResolvedValue({
      id: 'round-1',
      name: 'Round 1',
      status: 'RUNNING',
    });
    mockPrisma.player_round_sessions.findUnique.mockResolvedValue(null);

    const app = buildApp(mockRepos, mockState);
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
    mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(true);
    mockPrisma.players.findUnique.mockResolvedValue({
      id: playerId,
      name: 'Alice',
      competition_id: competitionId,
    });
    mockRepos.rounds.findByCompetitionAndStatus.mockResolvedValue({
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

    const app = buildApp(mockRepos, mockState);
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
    mockRepos.teams.judgeAlreadyAssigned.mockResolvedValue(true);
    mockPrisma.players.findUnique.mockRejectedValue(new Error('DB error'));

    const app = buildApp(mockRepos, mockState);
    const res = await request(app)
      .get(`/api/competitions/${competitionId}/monitoring/player/${playerId}`)
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
      .expect(500);

    expect(res.body.code).toBe(500);
    expect(res.body.message).toBe('Internal server error');
  });
});

describe('PLAYER_GRID_UPDATE (judge-only WebSocket event with throttling)', () => {
  const SocketManager = require('../ws/SocketManager');
  const EmissionBus = require('../ws/EmissionBus');

  let socketManager, mockIo, mockOrchestrator, mockBus, gridMockState;

  beforeEach(() => {
    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      use: jest.fn(),
      on: jest.fn()
    };

    gridMockState = {
      getActivePlayers: jest.fn().mockResolvedValue({}),
      getStalePlayers: jest.fn().mockResolvedValue([]),
      removeActivePlayer: jest.fn().mockResolvedValue(),
      getIndividualPlayerGrid: jest.fn().mockResolvedValue(null),
      setIndividualPlayerGrid: jest.fn().mockResolvedValue(),
    };

    mockRepos.teams.getJudges = jest.fn().mockResolvedValue([
      { user_id: 'judge-1', username: 'judge1' },
      { user_id: 'judge-2', username: 'judge2' }
    ]);
    mockRepos.teams.findMemberTeam = jest.fn().mockResolvedValue(null);

    mockOrchestrator = { state: gridMockState };
    mockBus = new EmissionBus();

    socketManager = new SocketManager(mockIo, mockRepos, mockOrchestrator, mockBus, null);
  });

  test('emits PLAYER_GRID_UPDATE to each judge user room', async () => {
    const grid = [[1, 0], [0, 2]];
    await socketManager._emitPlayerGridUpdate('comp-1', 'player-1', 'puzzle-1', grid);

    // Should query judges
    expect(mockRepos.teams.getJudges).toHaveBeenCalledWith('comp-1');

    // Should emit to each judge's user room
    expect(mockIo.to).toHaveBeenCalledTimes(2);
    expect(mockIo.to).toHaveBeenCalledWith('user_judge-1');
    expect(mockIo.to).toHaveBeenCalledWith('user_judge-2');

    // Should emit 'event' with PLAYER_GRID_UPDATE
    expect(mockIo.emit).toHaveBeenCalledTimes(2);

    const msg = mockIo.emit.mock.calls[0][1];
    expect(msg.type).toBe('PLAYER_GRID_UPDATE');
    expect(msg.competitionId).toBe('comp-1');
    expect(msg.payload).toEqual({
      playerId: 'player-1',
      puzzleId: 'puzzle-1',
      grid: [[1, 0], [0, 2]],
    });
  });

  test('does not emit when no judges exist', async () => {
    mockRepos.teams.getJudges.mockResolvedValue([]);

    await socketManager._emitPlayerGridUpdate('comp-1', 'player-1', 'puzzle-1', [[1]]);

    expect(mockIo.to).not.toHaveBeenCalled();
    expect(mockIo.emit).not.toHaveBeenCalled();
  });

  test('throttles to max 2 events per second per player', async () => {
    const grid = [[1]];

    // First call: should emit
    await socketManager._emitPlayerGridUpdate('comp-1', 'player-1', 'puzzle-1', grid);
    expect(mockIo.emit).toHaveBeenCalledTimes(2); // 2 judges

    // Second call immediately: should be throttled
    await socketManager._emitPlayerGridUpdate('comp-1', 'player-1', 'puzzle-1', grid);
    expect(mockIo.emit).toHaveBeenCalledTimes(2); // still 2, not 4

    // Third call immediately: should still be throttled
    await socketManager._emitPlayerGridUpdate('comp-1', 'player-1', 'puzzle-1', grid);
    expect(mockIo.emit).toHaveBeenCalledTimes(2); // still 2

    // Wait for throttle window to expire (500ms)
    await new Promise(resolve => setTimeout(resolve, 600));

    // Fourth call after throttle window: should emit again
    await socketManager._emitPlayerGridUpdate('comp-1', 'player-1', 'puzzle-1', grid);
    expect(mockIo.emit).toHaveBeenCalledTimes(4); // now 4
  });

  test('does not throttle different players independently', async () => {
    const grid = [[1]];

    // Player 1: should emit
    await socketManager._emitPlayerGridUpdate('comp-1', 'player-1', 'puzzle-1', grid);
    expect(mockIo.emit).toHaveBeenCalledTimes(2);

    // Player 2: should also emit (different throttle key)
    await socketManager._emitPlayerGridUpdate('comp-1', 'player-2', 'puzzle-1', grid);
    expect(mockIo.emit).toHaveBeenCalledTimes(4);
  });

  test('handles errors gracefully without throwing', async () => {
    mockRepos.teams.getJudges.mockRejectedValue(new Error('DB error'));

    await expect(
      socketManager._emitPlayerGridUpdate('comp-1', 'player-1', 'puzzle-1', [[1]])
    ).resolves.not.toThrow();

    expect(mockIo.to).not.toHaveBeenCalled();
    expect(mockIo.emit).not.toHaveBeenCalled();
  });
});

describe('WebSocket Rate Limiting', () => {
  const SocketManager = require('../ws/SocketManager');
  const EmissionBus = require('../ws/EmissionBus');

  let socketManager, mockIo, mockOrchestrator, mockBus, rateLimitMockState;

  beforeEach(() => {
    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      use: jest.fn(),
      on: jest.fn()
    };

    rateLimitMockState = {
      getActivePlayers: jest.fn().mockResolvedValue({}),
      getStalePlayers: jest.fn().mockResolvedValue([]),
      removeActivePlayer: jest.fn().mockResolvedValue(),
    };

    mockRepos.teams.getJudges = jest.fn().mockResolvedValue([]);
    mockRepos.teams.findMemberTeam = jest.fn().mockResolvedValue(null);

    mockOrchestrator = { state: rateLimitMockState };
    mockBus = new EmissionBus();

    socketManager = new SocketManager(mockIo, mockRepos, mockOrchestrator, mockBus, null);
  });

  test('_createRateLimiter returns token bucket with correct initial state', () => {
    const limiter = socketManager._createRateLimiter();
    expect(limiter).toHaveProperty('consume');
    expect(typeof limiter.consume).toBe('function');

    // Should allow first event
    expect(limiter.consume()).toBe(true);
  });

  test('rate limiter allows events up to max tokens', () => {
    const limiter = socketManager._createRateLimiter();
    const maxTokens = socketManager._rateLimitMax;

    // Should allow maxTokens events
    for (let i = 0; i < maxTokens; i++) {
      expect(limiter.consume()).toBe(true);
    }

    // Next event should be rate-limited
    expect(limiter.consume()).toBe(false);
  });

  test('rate limiter refills tokens over time', async () => {
    const limiter = socketManager._createRateLimiter();
    const maxTokens = socketManager._rateLimitMax;

    // Exhaust all tokens
    for (let i = 0; i < maxTokens; i++) {
      limiter.consume();
    }
    expect(limiter.consume()).toBe(false);

    // Wait for refill (1 second = refillRate tokens)
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Should have refilled some tokens
    expect(limiter.consume()).toBe(true);
  });

  test('_checkRateLimit emits RATE_LIMIT_EXCEEDED when exceeded', () => {
    const mockSocket = { emit: jest.fn() };
    const limiter = socketManager._createRateLimiter();
    const maxTokens = socketManager._rateLimitMax;

    // Exhaust all tokens
    for (let i = 0; i < maxTokens; i++) {
      limiter.consume();
    }

    // Check rate limit should fail and emit error
    const result = socketManager._checkRateLimit(limiter, mockSocket, 'cell_fill');
    expect(result).toBe(false);

    // Should emit RATE_LIMIT_EXCEEDED event
    expect(mockSocket.emit).toHaveBeenCalledWith('event', {
      type: 'RATE_LIMIT_EXCEEDED',
      timestamp: expect.any(String),
      payload: {
        event: 'cell_fill',
        message: 'Too many requests, please slow down'
      }
    });
  });

  test('_checkRateLimit returns true when under limit', () => {
    const mockSocket = { emit: jest.fn() };
    const limiter = socketManager._createRateLimiter();

    const result = socketManager._checkRateLimit(limiter, mockSocket, 'cell_fill');
    expect(result).toBe(true);
    expect(mockSocket.emit).not.toHaveBeenCalled();
  });
});
