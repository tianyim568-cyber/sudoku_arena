// Regression test for F26 — stage configuration lock after publish.
//
// Before the fix, GameOrchestrator.configureStages accepted DRAFT OR PUBLISHED
// (it only rejected RUNNING/FINISHED). That contradicted the JSDoc ("Only
// allowed when competition is DRAFT") and meant an admin could reshape the
// competition after the access link had been distributed — an incoherent
// state for players and judges holding stale links.
//
// After the fix, only DRAFT is accepted. This test pins the new contract
// so a future change cannot accidentally reopen PUBLISHED.
//
// See Louise/POINTS_POUR_SYLVAIN §14bis (the original diagnosis) and
// DEVELOPMENT_PLAN_V3.md F26.

jest.mock('../../src/db/prisma', () => {
  const mockPrisma = {
    competitions: { findUnique: jest.fn() },
    competition_stages: { findMany: jest.fn(), delete: jest.fn(), update: jest.fn(), create: jest.fn() },
    rounds: { deleteMany: jest.fn() },
    $transaction: jest.fn(async (fn) => fn(mockPrisma)),
  };
  return {
    getPrisma: jest.fn(() => mockPrisma),
    disconnectPrisma: jest.fn(),
    __mockPrisma: mockPrisma,
  };
});

const { __mockPrisma: prisma } = require('../../src/db/prisma');
const GameOrchestrator = require('../../src/engine/GameOrchestrator');
const EmissionBus = require('../../src/ws/EmissionBus');
const MemoryStateRepository = require('../../src/state/MemoryStateRepository');

const COMP_ID = 'comp-uuid-f26';

function buildOrchestrator() {
  const repos = {
    scores: {}, teams: {}, puzzles: {}, rounds: {}, playerStates: {}, submissions: {}, users: {},
  };
  return new GameOrchestrator(repos, new MemoryStateRepository(), new EmissionBus());
}

beforeEach(() => {
  prisma.competitions.findUnique.mockReset();
  prisma.competition_stages.findMany.mockReset();
});

describe('GameOrchestrator.configureStages — post-publish lock (F26)', () => {
  test('DRAFT competition: configureStages is allowed', async () => {
    prisma.competitions.findUnique.mockResolvedValue({ id: COMP_ID, status: 'DRAFT' });
    prisma.competition_stages.findMany.mockResolvedValue([]);
    prisma.competition_stages.create.mockResolvedValue({ id: 's1', type: 'INDIVIDUAL', order_number: 1 });

    const orch = buildOrchestrator();
    // A minimal valid config: one INDIVIDUAL stage.
    // The call must NOT throw. We do not care about the exact return value —
    // the point of this test is the pre-check on status, not the transaction
    // body (already covered elsewhere).
    await expect(
      orch.configureStages(COMP_ID, [{ type: 'INDIVIDUAL', orderNumber: 1 }])
    ).resolves.toBeDefined();
  });

  test('PUBLISHED competition: configureStages is REJECTED', async () => {
    prisma.competitions.findUnique.mockResolvedValue({ id: COMP_ID, status: 'PUBLISHED' });
    const orch = buildOrchestrator();
    await expect(
      orch.configureStages(COMP_ID, [{ type: 'INDIVIDUAL', orderNumber: 1 }])
    ).rejects.toThrow(/已发布|published/i);
    // The transaction must NOT be reached — the guard fails BEFORE the
    // stages query. Enforcing this rules out a "check but still mutate"
    // regression where the guard is present but the code proceeds anyway.
    expect(prisma.competition_stages.findMany).not.toHaveBeenCalled();
  });

  test('RUNNING competition: configureStages is REJECTED', async () => {
    prisma.competitions.findUnique.mockResolvedValue({ id: COMP_ID, status: 'RUNNING' });
    const orch = buildOrchestrator();
    await expect(
      orch.configureStages(COMP_ID, [{ type: 'INDIVIDUAL', orderNumber: 1 }])
    ).rejects.toThrow();
  });

  test('FINISHED competition: configureStages is REJECTED', async () => {
    prisma.competitions.findUnique.mockResolvedValue({ id: COMP_ID, status: 'FINISHED' });
    const orch = buildOrchestrator();
    await expect(
      orch.configureStages(COMP_ID, [{ type: 'INDIVIDUAL', orderNumber: 1 }])
    ).rejects.toThrow();
  });

  test('non-existent competition: throws "not found"', async () => {
    prisma.competitions.findUnique.mockResolvedValue(null);
    const orch = buildOrchestrator();
    await expect(
      orch.configureStages(COMP_ID, [{ type: 'INDIVIDUAL', orderNumber: 1 }])
    ).rejects.toThrow(/不存在|not found/i);
  });
});
