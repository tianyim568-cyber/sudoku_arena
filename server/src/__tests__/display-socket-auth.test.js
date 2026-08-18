/**
 * Display WebSocket auth tests — SocketManager dual auth + display room routing.
 *
 * Test categories:
 * 1. Auth middleware — display token path
 * 2. Auth middleware — JWT path (regression)
 * 3. Display connection isolation
 * 4. Emission routing to display room
 * 5. Token revocation emission
 */

const jwt = require('jsonwebtoken');
const EmissionBus = require('../ws/EmissionBus');
const SocketManager = require('../ws/SocketManager');
const DisplayManager = require('../engine/DisplayManager');

// Mock prisma for DisplayManager internal calls
jest.mock('../db/prisma', () => ({
  getPrisma: jest.fn(() => mockPrisma),
}));

const mockPrisma = {
  competitions: {
    update: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  },
};

// Mock config
jest.mock('../config', () => ({
  JWT_SECRET: 'test-secret',
  WS_RATE_LIMIT: 10,
}));

// ─── Socket.IO Mock Infrastructure ─────────────────────────────

/**
 * Build a mock Socket.IO Server that captures middleware and connection
 * handlers so tests can drive the auth flow manually.
 */
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

/**
 * Build a mock socket with handshake auth data.
 */
function createMockSocket(auth = {}) {
  const eventHandlers = {};
  const rooms = [];

  return {
    handshake: { auth },
    user: null,
    isDisplay: false,
    join(room) { rooms.push(room); },
    on(event, fn) { eventHandlers[event] = fn; },
    emit: jest.fn(),
    rooms,
    _eventHandlers: eventHandlers,
  };
}

/**
 * Run the middleware chain on a socket and return the result.
 * Resolves with null on success, or the Error on rejection.
 */
async function runMiddleware(middlewares, socket) {
  for (const mw of middlewares) {
    await new Promise((resolve, reject) => {
      mw(socket, (err) => err ? reject(err) : resolve());
    });
  }
}

// ─── Test Setup ────────────────────────────────────────────────

describe('Display WebSocket Auth', () => {
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
      teams: { getJudges: jest.fn().mockResolvedValue([]) },
      participants: { findByCompetition: jest.fn().mockResolvedValue([]) },
    };

    mockOrchestrator = {
      getReconnectState: jest.fn(),
      state: { getActivePlayers: jest.fn().mockResolvedValue([]) },
    };

    mockPresenceService = {
      refreshHeartbeat: jest.fn(),
    };
  });

  // ─── 1. Display Token Auth Path ──────────────────────────────

  describe('Auth middleware — display token path', () => {
    test('valid display token → socket connects with isDisplay=true', async () => {
      mockDisplayManager.verifyToken.mockResolvedValue('comp-uuid-123');
      const { io, middlewares } = createMockIO();

      new SocketManager(io, mockRepos, mockOrchestrator, new EmissionBus(), mockPresenceService, mockDisplayManager);

      const socket = createMockSocket({ displayToken: 'valid-token' });
      await runMiddleware(middlewares, socket);

      expect(mockDisplayManager.verifyToken).toHaveBeenCalledWith('valid-token');
      expect(socket.isDisplay).toBe(true);
      expect(socket.user).toEqual({
        role: 'DISPLAY',
        competitionId: 'comp-uuid-123',
        userId: null,
      });
    });

    test('invalid display token → connection rejected', async () => {
      mockDisplayManager.verifyToken.mockResolvedValue(null);
      const { io, middlewares } = createMockIO();

      new SocketManager(io, mockRepos, mockOrchestrator, new EmissionBus(), mockPresenceService, mockDisplayManager);

      const socket = createMockSocket({ displayToken: 'bad-token' });

      await expect(runMiddleware(middlewares, socket))
        .rejects
        .toThrow('Invalid display token');
    });

    test('verifyToken throws → connection rejected', async () => {
      mockDisplayManager.verifyToken.mockRejectedValue(new Error('DB down'));
      const { io, middlewares } = createMockIO();

      new SocketManager(io, mockRepos, mockOrchestrator, new EmissionBus(), mockPresenceService, mockDisplayManager);

      const socket = createMockSocket({ displayToken: 'some-token' });

      await expect(runMiddleware(middlewares, socket))
        .rejects
        .toThrow('Invalid display token');
    });

    test('display token takes precedence when both provided', async () => {
      mockDisplayManager.verifyToken.mockResolvedValue('comp-uuid');
      const { io, middlewares } = createMockIO();

      new SocketManager(io, mockRepos, mockOrchestrator, new EmissionBus(), mockPresenceService, mockDisplayManager);

      const socket = createMockSocket({ displayToken: 'valid-token', token: 'some-jwt' });
      await runMiddleware(middlewares, socket);

      // Should have gone through display path, not JWT
      expect(socket.isDisplay).toBe(true);
      expect(socket.user.role).toBe('DISPLAY');
    });

    test('no displayManager available → display token rejected', async () => {
      const { io, middlewares } = createMockIO();

      // No displayManager passed (null/undefined)
      new SocketManager(io, mockRepos, mockOrchestrator, new EmissionBus(), mockPresenceService, null);

      const socket = createMockSocket({ displayToken: 'valid-token' });

      await expect(runMiddleware(middlewares, socket))
        .rejects
        .toThrow('Display authentication not available');
    });
  });

  // ─── 2. JWT Auth Path (Regression) ──────────────────────────

  describe('Auth middleware — JWT path (regression)', () => {
    test('valid JWT → socket connects with isDisplay=false', async () => {
      const { io, middlewares } = createMockIO();
      const bus = new EmissionBus();

      new SocketManager(io, mockRepos, mockOrchestrator, bus, mockPresenceService, mockDisplayManager);

      const token = jwt.sign(
        { userId: 'user-1', username: 'player1', role: 'PLAYER' },
        'test-secret',
      );
      const socket = createMockSocket({ token });
      await runMiddleware(middlewares, socket);

      expect(socket.isDisplay).toBe(false);
      expect(socket.user.username).toBe('player1');
      expect(socket.user.role).toBe('PLAYER');
    });

    test('invalid JWT → connection rejected', async () => {
      const { io, middlewares } = createMockIO();

      new SocketManager(io, mockRepos, mockOrchestrator, new EmissionBus(), mockPresenceService, mockDisplayManager);

      const socket = createMockSocket({ token: 'bad.jwt' });

      await expect(runMiddleware(middlewares, socket))
        .rejects
        .toThrow('Invalid token');
    });

    test('no auth at all → connection rejected with "Authentication required"', async () => {
      const { io, middlewares } = createMockIO();

      new SocketManager(io, mockRepos, mockOrchestrator, new EmissionBus(), mockPresenceService, mockDisplayManager);

      const socket = createMockSocket({});

      await expect(runMiddleware(middlewares, socket))
        .rejects
        .toThrow('Authentication required');
    });
  });

  // ─── 3. Display Connection Isolation ──────────────────────────

  describe('Display connection isolation', () => {
    test('display socket auto-joins display room', () => {
      const { io, connectionHandlers } = createMockIO();
      const bus = new EmissionBus();

      new SocketManager(io, mockRepos, mockOrchestrator, bus, mockPresenceService, mockDisplayManager);

      // Simulate a display connection (post-auth)
      const socket = createMockSocket();
      socket.isDisplay = true;
      socket.user = { role: 'DISPLAY', competitionId: 'comp-uuid-456', userId: null };

      // Trigger the connection handler
      for (const handler of connectionHandlers) {
        handler(socket);
      }

      expect(socket.rooms).toContain('display_comp-uuid-456');
    });

    test('display socket does NOT set up heartbeat or game events', () => {
      const { io, connectionHandlers } = createMockIO();
      const bus = new EmissionBus();

      new SocketManager(io, mockRepos, mockOrchestrator, bus, mockPresenceService, mockDisplayManager);

      const socket = createMockSocket();
      socket.isDisplay = true;
      socket.user = { role: 'DISPLAY', competitionId: 'comp-uuid-789', userId: null };

      for (const handler of connectionHandlers) {
        handler(socket);
      }

      // Display socket should only have 'disconnect' handler, no game events
      const registeredEvents = Object.keys(socket._eventHandlers);
      expect(registeredEvents).toEqual(['disconnect']);
      expect(registeredEvents).not.toContain('join_room');
      expect(registeredEvents).not.toContain('cell_fill');
      expect(registeredEvents).not.toContain('answer_submit');
    });

    test('display socket does NOT join user room', () => {
      const { io, connectionHandlers } = createMockIO();
      const bus = new EmissionBus();

      new SocketManager(io, mockRepos, mockOrchestrator, bus, mockPresenceService, mockDisplayManager);

      const socket = createMockSocket();
      socket.isDisplay = true;
      socket.user = { role: 'DISPLAY', competitionId: 'comp-uuid', userId: null };

      for (const handler of connectionHandlers) {
        handler(socket);
      }

      // Should not contain user_ room
      const userRooms = socket.rooms.filter(r => r.startsWith('user_'));
      expect(userRooms).toHaveLength(0);
    });
  });

  // ─── 4. Emission Routing to Display Room ─────────────────────

  describe('Emission routing to display room', () => {
    test('DISPLAY_MODE_CHANGED reaches display room', () => {
      const { io } = createMockIO();
      const bus = new EmissionBus();

      new SocketManager(io, mockRepos, mockOrchestrator, bus, mockPresenceService, mockDisplayManager);

      bus.emitImmediate({
        target: 'display',
        targetId: 'comp-uuid',
        event: 'DISPLAY_MODE_CHANGED',
        payload: { mode: 'LIVE_RANKING', competitionId: 'comp-uuid' },
      });

      expect(io.to).toHaveBeenCalledWith('display_comp-uuid');
      const toResult = io.to('display_comp-uuid');
      // Verify emit was called (the mock returns a new object each time, so check the last call)
      const emitCalls = io.to.mock.results
        .filter(r => r.value && r.value.emit)
        .map(r => r.value.emit.mock.calls)
        .flat();

      // At least one emit call should have type DISPLAY_MODE_CHANGED
      const hasDisplayModeEvent = emitCalls.some(
        call => call[0] === 'event' && call[1]?.type === 'DISPLAY_MODE_CHANGED'
      );
      expect(hasDisplayModeEvent).toBe(true);
    });

    test('RANKING_UPDATE reaches display room', () => {
      const { io } = createMockIO();
      const bus = new EmissionBus();

      new SocketManager(io, mockRepos, mockOrchestrator, bus, mockPresenceService, mockDisplayManager);

      bus.emitImmediate({
        target: 'display',
        targetId: 'comp-uuid',
        event: 'RANKING_UPDATE',
        payload: { categoryId: null, snapshot: { test: true } },
      });

      expect(io.to).toHaveBeenCalledWith('display_comp-uuid');
    });

    test('competition emission does NOT go to display room', () => {
      const { io } = createMockIO();
      const bus = new EmissionBus();

      new SocketManager(io, mockRepos, mockOrchestrator, bus, mockPresenceService, mockDisplayManager);

      bus.emitImmediate({
        target: 'competition',
        targetId: 'comp-uuid',
        event: 'ROUND_STARTED',
        payload: {},
      });

      // Should emit to competition room, not display room
      expect(io.to).toHaveBeenCalledWith('competition_comp-uuid');
      // Verify display room was NOT targeted
      const displayCalls = io.to.mock.calls.filter(
        call => call[0] === 'display_comp-uuid'
      );
      expect(displayCalls).toHaveLength(0);
    });
  });

  // ─── 5. Token Revocation Emission ────────────────────────────

  describe('Token revocation emission', () => {
    test('revokeToken emits DISPLAY_TOKEN_REVOKED to display room', async () => {
      const bus = new EmissionBus();
      const displayManager = new DisplayManager({}, bus);

      // Spy on bus.emitImmediate
      const emitSpy = jest.spyOn(bus, 'emitImmediate');

      mockPrisma.competitions.update.mockResolvedValue({});

      await displayManager.revokeToken('comp-uuid');

      expect(mockPrisma.competitions.update).toHaveBeenCalledWith({
        where: { id: 'comp-uuid' },
        data: { display_access_token: null },
      });

      expect(emitSpy).toHaveBeenCalledWith({
        target: 'display',
        targetId: 'comp-uuid',
        event: 'DISPLAY_TOKEN_REVOKED',
        payload: { message: '显示令牌已被撤销' },
      });
    });
  });
});
