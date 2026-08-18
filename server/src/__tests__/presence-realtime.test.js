/**
 * Presence real-time status emission tests.
 *
 * Verifies that SocketManager emits PARTICIPANT_STATUS_CHANGE to the
 * competition room on join_room / leave_room, and registers competitions
 * with PresenceService for offline detection via heartbeat sweep.
 *
 * Test categories:
 * 1. join_room → PARTICIPANT_STATUS_CHANGE online emission
 * 2. join_room → presenceService.addCompetition() registration
 * 3. leave_room → PARTICIPANT_STATUS_CHANGE offline emission
 */

const jwt = require('jsonwebtoken');
const EmissionBus = require('../ws/EmissionBus');
const SocketManager = require('../ws/SocketManager');

// Mock prisma
jest.mock('../db/prisma', () => ({
  getPrisma: jest.fn(() => mockPrisma),
}));

const mockPrisma = {
  players: { findFirst: jest.fn() },
  puzzle_answers: { findFirst: jest.fn() },
  competitions: { update: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
};

// Mock config
jest.mock('../config', () => ({
  JWT_SECRET: 'test-secret',
  WS_RATE_LIMIT: 10,
  HEARTBEAT_INTERVAL_MS: 30000,
}));

// ─── Mock Infrastructure ─────────────────────────────────────

function createMockIO() {
  const middlewares = [];
  const connectionHandlers = [];

  const io = {
    use(fn) { middlewares.push(fn); },
    on(event, fn) { if (event === 'connection') connectionHandlers.push(fn); },
    to: jest.fn(() => ({ emit: jest.fn() })),
  };

  return { io, middlewares, connectionHandlers };
}

function createMockSocket(auth = {}) {
  const eventHandlers = {};
  const rooms = [];

  return {
    handshake: { auth },
    user: null,
    isDisplay: false,
    join(room) { rooms.push(room); },
    leave(room) {
      const idx = rooms.indexOf(room);
      if (idx !== -1) rooms.splice(idx, 1);
    },
    on(event, fn) { eventHandlers[event] = fn; },
    use: jest.fn(),
    emit: jest.fn(),
    rooms,
    _eventHandlers: eventHandlers,
  };
}

async function runMiddleware(middlewares, socket) {
  for (const mw of middlewares) {
    await new Promise((resolve, reject) => {
      mw(socket, (err) => err ? reject(err) : resolve());
    });
  }
}

// ─── Test Setup ────────────────────────────────────────────

describe('Presence Real-Time Status Emission', () => {
  let mockDisplayManager;
  let mockRepos;
  let mockOrchestrator;
  let mockPresenceService;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDisplayManager = {
      verifyToken: jest.fn(),
    };

    mockRepos = {
      teams: {
        getJudges: jest.fn().mockResolvedValue([]),
        findMemberTeam: jest.fn().mockResolvedValue(null),
        getMembersWithDetails: jest.fn().mockResolvedValue([]),
      },
      participants: { findByCompetition: jest.fn().mockResolvedValue([]) },
    };

    mockOrchestrator = {
      getReconnectState: jest.fn().mockResolvedValue(null),
      state: {
        getActivePlayers: jest.fn().mockResolvedValue({}),
        setActivePlayer: jest.fn().mockResolvedValue(undefined),
        removeActivePlayer: jest.fn().mockResolvedValue(undefined),
        getIndividualPlayerGrid: jest.fn().mockResolvedValue(null),
        setIndividualPlayerGrid: jest.fn().mockResolvedValue(undefined),
      },
      clearRound3PlayerFocus: jest.fn(),
    };

    mockPresenceService = {
      addCompetition: jest.fn(),
      removeCompetition: jest.fn(),
      refreshHeartbeat: jest.fn(),
    };
  });

  /**
   * Helper: create a SocketManager, connect a JWT-authenticated socket,
   * and return the socket + io + connectionHandlers for driving events.
   */
  function setupConnectedSocket() {
    const { io, connectionHandlers } = createMockIO();
    const bus = new EmissionBus();

    new SocketManager(io, mockRepos, mockOrchestrator, bus, mockPresenceService, mockDisplayManager);

    // Create a JWT-authenticated player socket
    const token = jwt.sign(
      { userId: 'user-1', username: 'player1', role: 'PLAYER' },
      'test-secret',
    );
    const socket = createMockSocket({ token });

    // Run auth middleware
    // (We'll do this synchronously since the socket.user is already set by middleware)
    // Instead, simulate post-auth state directly:
    socket.user = { userId: 'user-1', username: 'player1', role: 'PLAYER' };
    socket.isDisplay = false;

    // Trigger connection handler
    for (const handler of connectionHandlers) {
      handler(socket);
    }

    return { socket, io, connectionHandlers, bus };
  }

  // ─── 1. join_room → PARTICIPANT_STATUS_CHANGE online ──────────

  describe('join_room emits PARTICIPANT_STATUS_CHANGE to competition room', () => {
    test('emits online status to competition room on join_room', async () => {
      const { socket, io } = setupConnectedSocket();

      const joinHandler = socket._eventHandlers['join_room'];
      expect(joinHandler).toBeDefined();

      await joinHandler({ tournamentId: 'comp-uuid-123' });

      // Verify emission to competition room
      const competitionEmitCalls = io.to.mock.calls.filter(
        call => call[0] === 'competition_comp-uuid-123'
      );
      expect(competitionEmitCalls.length).toBeGreaterThan(0);

      // Get the emit call for the competition room
      const toResult = io.to('competition_comp-uuid-123');
      const allEmitCalls = io.to.mock.results
        .filter((r, i) => io.to.mock.calls[i] && io.to.mock.calls[i][0] === 'competition_comp-uuid-123')
        .map(r => r.value.emit.mock.calls)
        .flat();

      const statusChangeCall = allEmitCalls.find(
        call => call[1]?.type === 'PARTICIPANT_STATUS_CHANGE'
      );
      expect(statusChangeCall).toBeDefined();
      expect(statusChangeCall[1].payload).toEqual({
        competitionId: 'comp-uuid-123',
        userId: 'user-1',
        username: 'player1',
        status: 'online',
      });
    });

    test('still emits PLAYER_STATUS_CHANGE to tournament room (backward compat)', async () => {
      const { socket, io } = setupConnectedSocket();

      const joinHandler = socket._eventHandlers['join_room'];
      await joinHandler({ tournamentId: 'comp-uuid-456' });

      // Verify tournament room still gets PLAYER_STATUS_CHANGE
      const allEmitCalls = io.to.mock.results
        .filter((r, i) => io.to.mock.calls[i] && io.to.mock.calls[i][0] === 'tournament_comp-uuid-456')
        .map(r => r.value.emit.mock.calls)
        .flat();

      const playerStatusCall = allEmitCalls.find(
        call => call[1]?.type === 'PLAYER_STATUS_CHANGE'
      );
      expect(playerStatusCall).toBeDefined();
      expect(playerStatusCall[1].payload.online).toBe(true);
    });
  });

  // ─── 2. join_room → presenceService.addCompetition() ─────────

  describe('join_room registers competition with PresenceService', () => {
    test('calls presenceService.addCompetition on join_room', async () => {
      const { socket } = setupConnectedSocket();

      const joinHandler = socket._eventHandlers['join_room'];
      await joinHandler({ tournamentId: 'comp-uuid-789' });

      expect(mockPresenceService.addCompetition).toHaveBeenCalledWith('comp-uuid-789');
    });

    test('does not call addCompetition if presenceService is null', async () => {
      // Set up without presenceService
      const { io, connectionHandlers } = createMockIO();
      const bus = new EmissionBus();

      new SocketManager(io, mockRepos, mockOrchestrator, bus, null, mockDisplayManager);

      const socket = createMockSocket();
      socket.user = { userId: 'user-1', username: 'player1', role: 'PLAYER' };
      socket.isDisplay = false;

      for (const handler of connectionHandlers) {
        handler(socket);
      }

      const joinHandler = socket._eventHandlers['join_room'];
      // Should not throw even without presenceService
      await expect(joinHandler({ tournamentId: 'comp-uuid' })).resolves.not.toThrow();
    });
  });

  // ─── 3. leave_room → PARTICIPANT_STATUS_CHANGE offline ────────

  describe('leave_room emits PARTICIPANT_STATUS_CHANGE offline', () => {
    test('emits offline status to competition room on leave_room', async () => {
      const { socket, io } = setupConnectedSocket();

      // First join, then leave
      const joinHandler = socket._eventHandlers['join_room'];
      await joinHandler({ tournamentId: 'comp-uuid-leave' });

      // Clear previous emit calls to isolate leave_room emissions
      io.to.mock.results.forEach(r => {
        if (r.value && r.value.emit) r.value.emit.mockClear();
      });
      io.to.mockClear();

      const leaveHandler = socket._eventHandlers['leave_room'];
      expect(leaveHandler).toBeDefined();

      leaveHandler({ tournamentId: 'comp-uuid-leave' });

      // Verify emission to competition room
      const allEmitCalls = io.to.mock.results
        .filter((r, i) => io.to.mock.calls[i] && io.to.mock.calls[i][0] === 'competition_comp-uuid-leave')
        .map(r => r.value.emit.mock.calls)
        .flat();

      const statusChangeCall = allEmitCalls.find(
        call => call[1]?.type === 'PARTICIPANT_STATUS_CHANGE'
      );
      expect(statusChangeCall).toBeDefined();
      expect(statusChangeCall[1].payload).toEqual({
        competitionId: 'comp-uuid-leave',
        userId: 'user-1',
        username: 'player1',
        status: 'offline',
      });
    });
  });
});
