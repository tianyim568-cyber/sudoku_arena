/**
 * Display mode tests — PUT /api/competitions/:id/display/mode and GET /api/display/:token/mode
 *
 * Test categories:
 * 1. Authorization (PUT only) — no token, PLAYER, JUDGE, ORG_ADMIN, SUPER_ADMIN
 * 2. Validation (PUT only) — invalid mode, empty body, all valid modes
 * 3. Success path (PUT) — database update, WebSocket emission, response envelope, error handling
 * 4. GET /display/:token/mode — invalid token, valid token, null mode, error handling
 * 5. GET /display/:token/ranking — regression test for displayMode field inclusion
 */

const request = require('supertest');
const express = require('express');
const { generateToken } = require('../middleware/auth');
const { createDisplayRouter } = require('../routes/display');
const DisplayManager = require('../engine/DisplayManager');
const EmissionBus = require('../ws/EmissionBus');

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
  competition_stages: {
    findMany: jest.fn(),
  },
  round_rankings: {
    findMany: jest.fn(),
  },
  final_rankings: {
    findMany: jest.fn(),
  },
  categories: {
    findMany: jest.fn(),
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

describe('Display Mode API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PUT /api/competitions/:id/display/mode', () => {
    const competitionId = 'comp-uuid';
    const url = `/api/competitions/${competitionId}/display/mode`;

    describe('Authorization', () => {
      test('rejects request without auth token (401)', async () => {
        const app = buildApp();
        const res = await request(app)
          .put(url)
          .send({ mode: 'LIVE_RANKING' })
          .expect(401);

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
          .send({ mode: 'LIVE_RANKING' })
          .expect(403);

        expect(res.body.code).toBe(40301);
        expect(res.body.data).toBeNull();
      });

      test('rejects JUDGE role (403)', async () => {
        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${JUDGE_TOKEN}`)
          .send({ mode: 'LIVE_RANKING' })
          .expect(403);

        expect(res.body.code).toBe(40301);
      });

      test('allows ORG_ADMIN role', async () => {
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send({ mode: 'DEFAULT' })
          .expect(200);

        expect(res.body.code).toBe(200);
      });

      test('allows SUPER_ADMIN role', async () => {
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${SUPER_ADMIN_TOKEN}`)
          .send({ mode: 'DEFAULT' })
          .expect(200);

        expect(res.body.code).toBe(200);
      });
    });

    describe('Validation', () => {
      test('rejects invalid mode value (400)', async () => {
        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send({ mode: 'INVALID_MODE' })
          .expect(200); // validateBody returns 200 with error code in body

        expect(res.body).toEqual({
          code: 40001,
          message: expect.stringContaining('Invalid option'),
          data: null,
        });
      });

      test('rejects empty request body (400)', async () => {
        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send({})
          .expect(200);

        expect(res.body.code).toBe(40001);
        expect(res.body.message).toContain('Invalid option');
      });

      test('accepts all valid DisplayMode values', async () => {
        const validModes = [
          'DEFAULT',
          'LIVE_RANKING',
          'PLAYER_BROADCAST',
          'ROUND_RANKING',
          'STAGE_RANKING',
          'FINAL_RANKING',
        ];

        mockPrisma.competitions.update.mockResolvedValue({});

        for (const mode of validModes) {
          const app = buildApp();
          const res = await request(app)
            .put(url)
            .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
            .send({ mode })
            .expect(200);

          expect(res.body.code).toBe(200);
          expect(res.body.data.mode).toBe(mode);
        }
      });
    });

    describe('Success path', () => {
      test('updates competition display_mode in database', async () => {
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        await request(app)
          .put(url)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send({ mode: 'LIVE_RANKING' })
          .expect(200);

        expect(mockPrisma.competitions.update).toHaveBeenCalledWith({
          where: { id: competitionId },
          data: { display_mode: 'LIVE_RANKING' },
        });
      });

      test('emits DISPLAY_MODE_CHANGED WebSocket event', async () => {
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        await request(app)
          .put(url)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send({ mode: 'PLAYER_BROADCAST' })
          .expect(200);

        expect(mockBus.emitImmediate).toHaveBeenCalledWith({
          target: 'display',
          targetId: competitionId,
          event: 'DISPLAY_MODE_CHANGED',
          payload: {
            mode: 'PLAYER_BROADCAST',
            competitionId,
          },
        });
      });

      test('returns correct response envelope', async () => {
        mockPrisma.competitions.update.mockResolvedValue({});

        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send({ mode: 'FINAL_RANKING' })
          .expect(200);

        expect(res.body).toEqual({
          code: 200,
          message: 'success',
          data: { mode: 'FINAL_RANKING' },
        });
      });

      test('handles database errors gracefully (500)', async () => {
        mockPrisma.competitions.update.mockRejectedValue(new Error('DB error'));

        const app = buildApp();
        const res = await request(app)
          .put(url)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send({ mode: 'DEFAULT' })
          .expect(200);

        expect(res.body).toEqual({
          code: 50000,
          message: '设置显示模式失败',
          data: null,
        });
      });
    });
  });

  describe('GET /api/display/:token/mode', () => {
    const token = 'valid-display-token';
    const competitionId = 'comp-uuid';
    const url = `/api/display/${token}/mode`;

    test('rejects invalid display token (401)', async () => {
      mockPrisma.competitions.findFirst.mockResolvedValue(null);

      const app = buildApp();
      const res = await request(app)
        .get(url)
        .expect(401);

      expect(res.body).toEqual({
        code: 40102,
        message: '显示令牌无效',
        data: null,
      });
    });

    test('returns current display mode for valid token', async () => {
      mockPrisma.competitions.findFirst.mockResolvedValue({ id: competitionId });
      mockPrisma.competitions.findUnique.mockResolvedValue({ display_mode: 'LIVE_RANKING' });

      const app = buildApp();
      const res = await request(app)
        .get(url)
        .expect(200);

      expect(res.body).toEqual({
        code: 200,
        message: 'success',
        data: { mode: 'LIVE_RANKING' },
      });
    });

    test('defaults to DEFAULT when display_mode is null', async () => {
      mockPrisma.competitions.findFirst.mockResolvedValue({ id: competitionId });
      mockPrisma.competitions.findUnique.mockResolvedValue({ display_mode: null });

      const app = buildApp();
      const res = await request(app)
        .get(url)
        .expect(200);

      expect(res.body.data.mode).toBe('DEFAULT');
    });

    test('handles database errors gracefully (500)', async () => {
      mockPrisma.competitions.findFirst.mockResolvedValue({ id: competitionId });
      mockPrisma.competitions.findUnique.mockRejectedValue(new Error('DB error'));

      const app = buildApp();
      const res = await request(app)
        .get(url)
        .expect(200);

      expect(res.body).toEqual({
        code: 50000,
        message: '获取显示模式失败',
        data: null,
      });
    });
  });

  describe('GET /api/display/:token/ranking (regression)', () => {
    const token = 'valid-display-token';
    const competitionId = 'comp-uuid';
    const url = `/api/display/${token}/ranking`;

    test('includes displayMode field in ranking response', async () => {
      mockPrisma.competitions.findFirst.mockResolvedValue({ id: competitionId });
      mockPrisma.competitions.findUnique.mockResolvedValue({
        id: competitionId,
        name: 'Test Competition',
        status: 'ACTIVE',
        display_mode: 'ROUND_RANKING',
        competition_stages: [],
      });
      mockPrisma.competition_stages.findMany.mockResolvedValue([]);
      mockPrisma.round_rankings.findMany.mockResolvedValue([]);
      mockPrisma.final_rankings.findMany.mockResolvedValue([]);
      mockPrisma.categories.findMany.mockResolvedValue([]);

      const app = buildApp();
      const res = await request(app)
        .get(url)
        .expect(200);

      expect(res.body.code).toBe(200);
      expect(res.body.data).toHaveProperty('displayMode', 'ROUND_RANKING');
      expect(res.body.data).toHaveProperty('competition');
      expect(res.body.data).toHaveProperty('stages');
    });

    test('defaults displayMode to DEFAULT when null', async () => {
      mockPrisma.competitions.findFirst.mockResolvedValue({ id: competitionId });
      mockPrisma.competitions.findUnique.mockResolvedValue({
        id: competitionId,
        name: 'Test Competition',
        status: 'ACTIVE',
        display_mode: null,
        competition_stages: [],
      });
      mockPrisma.competition_stages.findMany.mockResolvedValue([]);
      mockPrisma.round_rankings.findMany.mockResolvedValue([]);
      mockPrisma.final_rankings.findMany.mockResolvedValue([]);
      mockPrisma.categories.findMany.mockResolvedValue([]);

      const app = buildApp();
      const res = await request(app)
        .get(url)
        .expect(200);

      expect(res.body.data.displayMode).toBe('DEFAULT');
    });
  });
});
