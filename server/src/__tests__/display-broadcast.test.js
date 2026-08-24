/**
 * Display broadcast player tests — PUT /api/competitions/:id/display/broadcast/:playerId
 *
 * Test categories:
 * 1. Authorization — no token, PLAYER, ORG_ADMIN (rejected), JUDGE, SUPER_ADMIN (allowed).
 *    Product decision 2026-08-24: projection is a floor operation reserved for the
 *    JUDGE. ORG_ADMIN is intentionally excluded even though it is normally the more
 *    privileged role — see routes/display.js docstring for the rationale.
 * 2. Success path — player validation, database update, WebSocket emission
 * 3. Error handling — player not found, database errors
 * 4. DELETE /api/competitions/:id/display/broadcast — stop broadcast
 */

const request = require('supertest');
const express = require('express');
const { generateToken } = require('../middleware/auth');
const { createDisplayRouter } = require('../routes/display');
const DisplayManager = require('../engine/DisplayManager');

// Mock prisma
jest.mock('../db/prisma', () => ({
  getPrisma: jest.fn(() => mockPrisma),
}));

const mockPrisma = {
  competitions: {
    update: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  players: {
    findFirst: jest.fn(),
  },
};

// Mock db connection for tenantGuard
jest.mock('../db/connection', () => ({
  getConnection: jest.fn(() => ({
    get: jest.fn(() => ({ id: 'comp-uuid' })),
  })),
}));

const mockBus = {
  emitImmediate: jest.fn(),
};

const ADMIN_TOKEN = generateToken({
  id: 'admin-uuid',
  username: 'admin',
  role: 'ORG_ADMIN',
  organization_id: 'org-uuid',
});

const SUPER_ADMIN_TOKEN = generateToken({
  id: 'superadmin-uuid',
  username: 'superadmin',
  role: 'SUPER_ADMIN',
  organization_id: 'org-uuid',
});

const PLAYER_TOKEN = generateToken({
  id: 'player-uuid',
  username: 'player',
  role: 'PLAYER',
  organization_id: 'org-uuid',
});

const JUDGE_TOKEN = generateToken({
  id: 'judge-uuid',
  username: 'judge',
  role: 'JUDGE',
  organization_id: 'org-uuid',
});

function buildApp() {
  const app = express();
  app.use(express.json());
  const displayManager = new DisplayManager({}, mockBus);
  app.use('/api', createDisplayRouter(displayManager));
  return app;
}

describe('Display Broadcast Player API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PUT /api/competitions/:id/display/broadcast/:playerId', () => {
    const competitionId = 'comp-uuid';
    const playerId = 'player-uuid-123';
    const url = `/api/competitions/${competitionId}/display/broadcast/${playerId}`;

    const mockPlayer = {
      id: playerId,
      name: '张三',
      school: '北京中学',
      province: '北京',
      age: 14,
      categories: {
        id: 'cat-uuid',
        name: '初中组',
        min_age: 12,
        max_age: 15,
      },
    };

    describe('Authorization', () => {
      test('rejects request without auth token (401)', async () => {
        const app = buildApp();
        const res = await request(app).put(url).expect(401);

        expect(res.body).toEqual({
          code: 40101,
          message: '未登录',
          data: null,
        });
      });

      test('rejects PLAYER role (403)', async () => {
        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
          .expect(403);

        expect(res.body.code).toBe(40301);
        expect(res.body.data).toBeNull();
      });

      test('rejects ORG_ADMIN role (403) — projection reserved for JUDGE', async () => {
        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .expect(403);

        expect(res.body.code).toBe(40301);
      });

      test('allows JUDGE role', async () => {
        mockPrisma.players.findFirst.mockResolvedValue(mockPlayer);
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .expect(200);

        expect(res.body.code).toBe(200);
      });

      test('allows SUPER_ADMIN role (platform debugging)', async () => {
        mockPrisma.players.findFirst.mockResolvedValue(mockPlayer);
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${SUPER_ADMIN_TOKEN}`)
          .expect(200);

        expect(res.body.code).toBe(200);
      });
    });

    describe('Success path', () => {
      test('validates player belongs to competition', async () => {
        mockPrisma.players.findFirst.mockResolvedValue(mockPlayer);
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        await request(app)
          .put(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .expect(200);

        expect(mockPrisma.players.findFirst).toHaveBeenCalledWith({
          where: {
            id: playerId,
            competition_id: competitionId,
          },
          select: expect.any(Object),
        });
      });

      test('updates competition display_mode to PLAYER_BROADCAST', async () => {
        mockPrisma.players.findFirst.mockResolvedValue(mockPlayer);
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        await request(app)
          .put(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .expect(200);

        expect(mockPrisma.competitions.update).toHaveBeenCalledWith({
          where: { id: competitionId },
          data: {
            display_mode: 'PLAYER_BROADCAST',
            broadcast_player_id: playerId,
          },
        });
      });

      test('emits DISPLAY_PLAYER_BROADCAST WebSocket event with player data', async () => {
        mockPrisma.players.findFirst.mockResolvedValue(mockPlayer);
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        await request(app)
          .put(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .expect(200);

        expect(mockBus.emitImmediate).toHaveBeenCalledWith({
          target: 'display',
          targetId: competitionId,
          event: 'DISPLAY_PLAYER_BROADCAST',
          payload: {
            mode: 'PLAYER_BROADCAST',
            player: {
              id: playerId,
              name: '张三',
              school: '北京中学',
              province: '北京',
              age: 14,
              category: mockPlayer.categories,
            },
            competitionId,
          },
        });
      });

      test('returns player data in response', async () => {
        mockPrisma.players.findFirst.mockResolvedValue(mockPlayer);
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .expect(200);

        expect(res.body).toEqual({
          code: 200,
          message: 'success',
          data: {
            player: {
              id: playerId,
              name: '张三',
              school: '北京中学',
              province: '北京',
              age: 14,
              category: mockPlayer.categories,
            },
          },
        });
      });

      test('handles player with null optional fields', async () => {
        const playerMinimal = {
          id: playerId,
          name: '李四',
          school: null,
          province: null,
          age: null,
          categories: null,
        };

        mockPrisma.players.findFirst.mockResolvedValue(playerMinimal);
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .expect(200);

        expect(res.body.code).toBe(200);
        expect(res.body.data.player.name).toBe('李四');
        expect(res.body.data.player.school).toBeNull();
      });
    });

    describe('Error handling', () => {
      test('returns 404 when player does not exist', async () => {
        mockPrisma.players.findFirst.mockResolvedValue(null);

        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .expect(200);

        expect(res.body).toEqual({
          code: 40400,
          message: '选手不存在或不属于此竞赛',
          data: null,
        });
      });

      test('returns 404 when player belongs to different competition', async () => {
        mockPrisma.players.findFirst.mockResolvedValue(null);

        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .expect(200);

        expect(res.body.code).toBe(40400);
        expect(res.body.message).toContain('不存在');
      });

      test('handles database errors gracefully (500)', async () => {
        mockPrisma.players.findFirst.mockRejectedValue(new Error('DB error'));

        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .expect(200);

        expect(res.body).toEqual({
          code: 50000,
          message: '设置选手直播失败',
          data: null,
        });
      });
    });
  });

  describe('DELETE /api/competitions/:id/display/broadcast', () => {
    const competitionId = 'comp-uuid';
    const url = `/api/competitions/${competitionId}/display/broadcast`;

    describe('Authorization', () => {
      test('rejects request without auth token (401)', async () => {
        const app = buildApp();
        const res = await request(app).delete(url).expect(401);

        expect(res.body).toEqual({
          code: 40101,
          message: '未登录',
          data: null,
        });
      });

      test('rejects PLAYER role (403)', async () => {
        const app = buildApp();
        const res = await request(app)
          .delete(url)
          .set('Authorization', `Bearer ${PLAYER_TOKEN}`)
          .expect(403);

        expect(res.body.code).toBe(40301);
      });

      test('rejects ORG_ADMIN role (403) — projection reserved for JUDGE', async () => {
        const app = buildApp();
        const res = await request(app)
          .delete(url)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .expect(403);

        expect(res.body.code).toBe(40301);
      });

      test('allows JUDGE role', async () => {
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        const res = await request(app)
          .delete(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .expect(200);

        expect(res.body.code).toBe(200);
      });

      test('allows SUPER_ADMIN role (platform debugging)', async () => {
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        const res = await request(app)
          .delete(url)
          .set('Authorization', `Bearer ${SUPER_ADMIN_TOKEN}`)
          .expect(200);

        expect(res.body.code).toBe(200);
      });
    });

    describe('Success path', () => {
      test('updates competition display_mode to DEFAULT', async () => {
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        await request(app)
          .delete(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .expect(200);

        expect(mockPrisma.competitions.update).toHaveBeenCalledWith({
          where: { id: competitionId },
          data: {
            display_mode: 'DEFAULT',
            broadcast_player_id: null,
          },
        });
      });

      test('emits DISPLAY_MODE_CHANGED WebSocket event with DEFAULT mode', async () => {
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        await request(app)
          .delete(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .expect(200);

        expect(mockBus.emitImmediate).toHaveBeenCalledWith({
          target: 'display',
          targetId: competitionId,
          event: 'DISPLAY_MODE_CHANGED',
          payload: {
            mode: 'DEFAULT',
            competitionId,
          },
        });
      });

      test('returns success response', async () => {
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        const res = await request(app)
          .delete(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .expect(200);

        expect(res.body).toEqual({
          code: 200,
          message: 'success',
          data: null,
        });
      });

      test('handles database errors gracefully (500)', async () => {
        mockPrisma.competitions.update.mockRejectedValue(new Error('DB error'));

        const app = buildApp();
        const res = await request(app)
          .delete(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .expect(200);

        expect(res.body).toEqual({
          code: 50000,
          message: '停止直播失败',
          data: null,
        });
      });
    });
  });
});
