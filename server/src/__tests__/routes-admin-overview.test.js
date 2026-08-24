// Unit tests for the Super Admin overview route (ISSUE-036, part 1).
//
// routes/admin.js exposes ONE route today:
//
//   GET /api/admin/overview  — platform-wide read-only aggregate:
//     stats.organizations              (scalar count)
//     stats.competitions.total         (scalar count)
//     stats.competitions.byStatus      (Prisma groupBy → { STATUS: n })
//     stats.users.byRole               (Prisma groupBy → { ROLE: n })
//     organizations[]                  (each with userCount + competitionCount)
//     competitions[]                   (recent, capped at 50, with org name)
//
// The router mounts SUPER_ADMIN-only at the router level (before any
// individual handler), so any non-SUPER_ADMIN token gets 403 without
// entering the handler.
//
// We mock the Prisma client so no database is needed. Each test installs
// its own resolved values; the shape assertions check that the handler
// reshapes groupBy results the way the client expects.

const express = require('express');
const request = require('supertest');
const { generateToken } = require('../middleware/auth');

// Mock Prisma. Every field the handler reads has its own jest.fn() so a
// test can override just the ones it cares about.
const mockPrisma = {
  organizations: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  competitions: {
    count: jest.fn(),
    groupBy: jest.fn(),
    findMany: jest.fn(),
  },
  users: {
    groupBy: jest.fn(),
  },
};

jest.mock('../db/prisma', () => ({
  getPrisma: () => mockPrisma,
}));

const { createAdminRouter } = require('../routes/admin');

// Real JWT tokens — the same generator the production app uses, so the
// auth middleware actually verifies signature + role.
const SUPER_ADMIN_TOKEN = generateToken({
  id: 'super-1', username: 'super', role: 'SUPER_ADMIN', organization_id: null,
});
const ORG_ADMIN_TOKEN = generateToken({
  id: 'admin-1', username: 'admin', role: 'ORG_ADMIN', organization_id: 'org-a',
});
const JUDGE_TOKEN = generateToken({
  id: 'judge-1', username: 'judge', role: 'JUDGE', organization_id: 'org-a',
});
const PLAYER_TOKEN = generateToken({
  id: 'player-1', username: 'player', role: 'PLAYER', organization_id: 'org-a',
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', createAdminRouter());
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/admin/overview — authorization', () => {
  test('rejects a request without a token (401)', async () => {
    const res = await request(buildApp()).get('/api/admin/overview');
    expect(res.status).toBe(401);
  });

  test('rejects an ORG_ADMIN (403) — platform view is SUPER_ADMIN-only', async () => {
    const res = await request(buildApp())
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${ORG_ADMIN_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('rejects a JUDGE (403)', async () => {
    const res = await request(buildApp())
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${JUDGE_TOKEN}`);
    expect(res.status).toBe(403);
  });

  test('rejects a PLAYER (403)', async () => {
    const res = await request(buildApp())
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/overview — happy path shape', () => {
  test('aggregates counts, groupBy reshape, and lists', async () => {
    mockPrisma.organizations.count.mockResolvedValue(3);
    mockPrisma.competitions.count.mockResolvedValue(7);
    mockPrisma.competitions.groupBy.mockResolvedValue([
      { status: 'DRAFT', _count: { _all: 2 } },
      { status: 'PUBLISHED', _count: { _all: 1 } },
      { status: 'RUNNING', _count: { _all: 3 } },
      { status: 'FINISHED', _count: { _all: 1 } },
    ]);
    mockPrisma.users.groupBy.mockResolvedValue([
      { role: 'ORG_ADMIN', _count: { _all: 4 } },
      { role: 'JUDGE', _count: { _all: 6 } },
      { role: 'PLAYER', _count: { _all: 120 } },
    ]);
    mockPrisma.organizations.findMany.mockResolvedValue([
      {
        id: 'org-a', name: 'Org A', status: 'ACTIVE',
        created_at: new Date('2026-01-01T00:00:00Z'),
        _count: { users: 10, competitions: 2 },
      },
      {
        id: 'org-b', name: 'Org B', status: 'ACTIVE',
        created_at: new Date('2026-02-01T00:00:00Z'),
        _count: { users: 5, competitions: 1 },
      },
    ]);
    mockPrisma.competitions.findMany.mockResolvedValue([
      {
        id: 'c-1', name: 'Spring Cup', status: 'RUNNING',
        created_at: new Date('2026-05-01T00:00:00Z'),
        organizations: { name: 'Org A' },
      },
      {
        id: 'c-2', name: 'Winter Cup', status: 'DRAFT',
        created_at: new Date('2026-04-01T00:00:00Z'),
        organizations: null, // orphaned competition — must still surface
      },
    ]);

    const res = await request(buildApp())
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${SUPER_ADMIN_TOKEN}`)
      .expect(200);

    expect(res.body.code).toBe(200);

    // Scalar counts.
    expect(res.body.data.stats.organizations).toBe(3);
    expect(res.body.data.stats.competitions.total).toBe(7);

    // groupBy reshape — the handler flattens { status, _count: { _all } }
    // into { STATUS: n } so the client can read `byStatus.RUNNING` directly.
    expect(res.body.data.stats.competitions.byStatus).toEqual({
      DRAFT: 2, PUBLISHED: 1, RUNNING: 3, FINISHED: 1,
    });
    expect(res.body.data.stats.users.byRole).toEqual({
      ORG_ADMIN: 4, JUDGE: 6, PLAYER: 120,
    });

    // Orgs list — flattened + _count expanded.
    expect(res.body.data.organizations).toHaveLength(2);
    expect(res.body.data.organizations[0]).toMatchObject({
      id: 'org-a', name: 'Org A', status: 'ACTIVE',
      userCount: 10, competitionCount: 2,
    });

    // Competitions list — recent + org name flattened. An orphaned
    // competition (no org relation) must still land, with null
    // organizationName rather than crashing.
    expect(res.body.data.competitions).toHaveLength(2);
    expect(res.body.data.competitions[0].organizationName).toBe('Org A');
    expect(res.body.data.competitions[1].organizationName).toBeNull();
  });

  test('returns zeros / empty arrays when the platform is empty', async () => {
    mockPrisma.organizations.count.mockResolvedValue(0);
    mockPrisma.competitions.count.mockResolvedValue(0);
    mockPrisma.competitions.groupBy.mockResolvedValue([]);
    mockPrisma.users.groupBy.mockResolvedValue([]);
    mockPrisma.organizations.findMany.mockResolvedValue([]);
    mockPrisma.competitions.findMany.mockResolvedValue([]);

    const res = await request(buildApp())
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${SUPER_ADMIN_TOKEN}`)
      .expect(200);

    expect(res.body.data.stats.organizations).toBe(0);
    expect(res.body.data.stats.competitions.total).toBe(0);
    expect(res.body.data.stats.competitions.byStatus).toEqual({});
    expect(res.body.data.stats.users.byRole).toEqual({});
    expect(res.body.data.organizations).toEqual([]);
    expect(res.body.data.competitions).toEqual([]);
  });
});

describe('GET /api/admin/overview — error handling', () => {
  test('returns a 50000 envelope when Prisma throws', async () => {
    mockPrisma.organizations.count.mockRejectedValue(new Error('db down'));

    const res = await request(buildApp())
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${SUPER_ADMIN_TOKEN}`)
      .expect(200);

    // App-wide convention: expected errors ride on HTTP 200 with a code
    // in the body. 5xx is reserved for unhandled crashes.
    expect(res.body.code).toBe(50000);
    expect(res.body.data).toBeNull();
  });
});
