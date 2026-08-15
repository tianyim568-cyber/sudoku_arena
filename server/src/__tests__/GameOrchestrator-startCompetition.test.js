// Unit tests for GameOrchestrator.startCompetition() — team-requirement fix.
//
// The original code unconditionally required teams:
//   if (teams.length === 0) throw new CompetitionError('没有队伍');
//
// After the fix, teams are only required when the competition has team-type
// stages. Individual-only competitions (only INDIVIDUAL_* round types) should
// start without any teams.
//
// We mock Prisma's getPrisma() to control the DB layer, and instantiate
// GameOrchestrator with minimal stubs for repos/state/bus.

jest.mock('../../src/db/prisma', () => {
  const mockPrisma = {
    competitions: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    teams: {
      findMany: jest.fn(),
    },
    competition_stages: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  return {
    getPrisma: jest.fn(() => mockPrisma),
    disconnectPrisma: jest.fn(),
    __mockPrisma: mockPrisma,
  };
});

const { getPrisma, __mockPrisma: prisma } = require('../../src/db/prisma');
const GameOrchestrator = require('../../src/engine/GameOrchestrator');
const EmissionBus = require('../../src/ws/EmissionBus');
const MemoryStateRepository = require('../../src/state/MemoryStateRepository');

const COMP_ID = 'comp-uuid-001';

function buildOrchestrator() {
  const repos = {
    scores: {},
    teams: {
      findByCompetition: jest.fn(async () => []),
      getCompetitionPlayers: jest.fn(async () => []),
    },
    puzzles: {},
    rounds: {},
    playerStates: {},
    submissions: {},
    users: {},
  };
  const state = new MemoryStateRepository();
  const bus = new EmissionBus();
  return new GameOrchestrator(repos, state, bus);
}

function resetPrismaMocks() {
  prisma.competitions.findUnique.mockReset();
  prisma.competitions.update.mockReset();
  prisma.teams.findMany.mockReset();
  prisma.competition_stages.findMany.mockReset();
  prisma.competition_stages.findFirst.mockReset();
}

function mockCompetitionDRAFT() {
  prisma.competitions.findUnique.mockResolvedValue({
    id: COMP_ID,
    name: 'Test Cup',
    status: 'DRAFT',
    organization_id: 'org-1',
  });
}

function mockStagesWithRounds(roundTypes) {
  const stageId = 'stage-uuid-001';
  const rounds = roundTypes.map((type, i) => ({
    id: `round-uuid-${i + 1}`,
    stage_id: stageId,
    name: `Round ${i + 1}`,
    type,
    order_number: i + 1,
    duration_seconds: 300,
    status: 'WAITING',
  }));
  prisma.competition_stages.findMany.mockResolvedValue([{
    id: stageId,
    competition_id: COMP_ID,
    type: roundTypes[0]?.startsWith('INDIVIDUAL') ? 'INDIVIDUAL' : 'TEAM',
    order_number: 1,
    status: 'WAITING',
    rounds,
  }]);
  prisma.competition_stages.findFirst.mockResolvedValue({
    id: stageId,
    competition_id: COMP_ID,
    type: roundTypes[0]?.startsWith('INDIVIDUAL') ? 'INDIVIDUAL' : 'TEAM',
    order_number: 1,
    status: 'WAITING',
  });
}

function mockTeams(teams) {
  prisma.teams.findMany.mockResolvedValue(teams);
}

function mockCompetitionUpdate() {
  prisma.competitions.update.mockResolvedValue({ id: COMP_ID, status: 'RUNNING' });
}

describe('GameOrchestrator.startCompetition — team requirement', () => {
  let orchestrator;

  beforeEach(() => {
    resetPrismaMocks();
    orchestrator = buildOrchestrator();
  });

  // ─── Individual-only competitions ─────────────────────────────

  test('individual-only competition starts WITHOUT teams', async () => {
    mockCompetitionDRAFT();
    mockStagesWithRounds([
      'INDIVIDUAL_STANDARD',
      'INDIVIDUAL_SHAPED',
      'INDIVIDUAL_MIXED',
    ]);
    mockTeams([]); // no teams
    mockCompetitionUpdate();

    const result = await orchestrator.startCompetition(COMP_ID);

    expect(result.result.competitionId).toBe(COMP_ID);
    expect(result.result.status).toBe('RUNNING');
    expect(prisma.competitions.update).toHaveBeenCalledWith({
      where: { id: COMP_ID },
      data: { status: 'RUNNING' },
    });
  });

  test('individual-only emission includes hasTeamStages: false', async () => {
    mockCompetitionDRAFT();
    mockStagesWithRounds([
      'INDIVIDUAL_STANDARD',
      'INDIVIDUAL_SHAPED',
      'INDIVIDUAL_MIXED',
    ]);
    mockTeams([]);
    mockCompetitionUpdate();

    const result = await orchestrator.startCompetition(COMP_ID);

    const emission = result.emissions.find(e => e.event === 'COMPETITION_STARTED');
    expect(emission).toBeDefined();
    expect(emission.payload.hasTeamStages).toBe(false);
    expect(emission.payload.teams).toEqual([]);
  });

  // ─── Team competitions still require teams ────────────────────

  test('team competition THROWS when no teams exist', async () => {
    mockCompetitionDRAFT();
    mockStagesWithRounds([
      'ROUND1_NINE_ONE',
      'ROUND2_RELAY',
      'ROUND3_COLLABORATE',
    ]);
    mockTeams([]); // no teams

    await expect(orchestrator.startCompetition(COMP_ID))
      .rejects.toThrow('没有队伍');
  });

  test('team competition STARTS when teams exist', async () => {
    mockCompetitionDRAFT();
    mockStagesWithRounds([
      'ROUND1_NINE_ONE',
      'ROUND2_RELAY',
      'ROUND3_COLLABORATE',
    ]);
    mockTeams([{ id: 'team-1', name: 'Alpha' }]);
    mockCompetitionUpdate();

    const result = await orchestrator.startCompetition(COMP_ID);

    expect(result.result.status).toBe('RUNNING');
    const emission = result.emissions.find(e => e.event === 'COMPETITION_STARTED');
    expect(emission.payload.hasTeamStages).toBe(true);
    expect(emission.payload.teams).toEqual([{ teamId: 'team-1', teamName: 'Alpha' }]);
  });

  // ─── Mixed competitions (team + individual stages) ────────────

  test('mixed competition requires teams (has team rounds)', async () => {
    mockCompetitionDRAFT();
    // Simulate a multi-stage competition with both team and individual rounds
    const stageTeam = {
      id: 'stage-team',
      competition_id: COMP_ID,
      type: 'TEAM',
      order_number: 1,
      status: 'WAITING',
      rounds: [
        { id: 'r1', type: 'ROUND1_NINE_ONE', order_number: 1 },
        { id: 'r2', type: 'ROUND2_RELAY', order_number: 2 },
        { id: 'r3', type: 'ROUND3_COLLABORATE', order_number: 3 },
      ],
    };
    const stageIndiv = {
      id: 'stage-indiv',
      competition_id: COMP_ID,
      type: 'INDIVIDUAL',
      order_number: 2,
      status: 'WAITING',
      rounds: [
        { id: 'r4', type: 'INDIVIDUAL_STANDARD', order_number: 1 },
      ],
    };
    prisma.competition_stages.findMany.mockResolvedValue([stageTeam, stageIndiv]);
    prisma.competition_stages.findFirst.mockResolvedValue(stageTeam);
    mockTeams([]);

    await expect(orchestrator.startCompetition(COMP_ID))
      .rejects.toThrow('没有队伍');
  });

  test('mixed competition starts when teams exist', async () => {
    mockCompetitionDRAFT();
    const stageTeam = {
      id: 'stage-team',
      competition_id: COMP_ID,
      type: 'TEAM',
      order_number: 1,
      status: 'WAITING',
      rounds: [
        { id: 'r1', type: 'ROUND1_NINE_ONE', order_number: 1 },
        { id: 'r2', type: 'ROUND2_RELAY', order_number: 2 },
      ],
    };
    const stageIndiv = {
      id: 'stage-indiv',
      competition_id: COMP_ID,
      type: 'INDIVIDUAL',
      order_number: 2,
      status: 'WAITING',
      rounds: [
        { id: 'r3', type: 'INDIVIDUAL_STANDARD', order_number: 1 },
      ],
    };
    prisma.competition_stages.findMany.mockResolvedValue([stageTeam, stageIndiv]);
    prisma.competition_stages.findFirst.mockResolvedValue(stageTeam);
    mockTeams([{ id: 'team-1', name: 'Alpha' }, { id: 'team-2', name: 'Beta' }]);
    mockCompetitionUpdate();

    const result = await orchestrator.startCompetition(COMP_ID);

    expect(result.result.status).toBe('RUNNING');
    const emission = result.emissions.find(e => e.event === 'COMPETITION_STARTED');
    expect(emission.payload.hasTeamStages).toBe(true);
    expect(emission.payload.teams).toHaveLength(2);
  });

  // ─── Pre-existing guards still work ───────────────────────────

  test('throws when competition does not exist', async () => {
    prisma.competitions.findUnique.mockResolvedValue(null);

    await expect(orchestrator.startCompetition(COMP_ID))
      .rejects.toThrow('比赛不存在');
  });

  test('throws when competition status is not DRAFT or PUBLISHED', async () => {
    prisma.competitions.findUnique.mockResolvedValue({
      id: COMP_ID,
      name: 'Running Cup',
      status: 'RUNNING',
    });

    await expect(orchestrator.startCompetition(COMP_ID))
      .rejects.toThrow('比赛状态不允许开始');
  });

  test('throws when competition has no stages', async () => {
    mockCompetitionDRAFT();
    prisma.competition_stages.findMany.mockResolvedValue([]);

    await expect(orchestrator.startCompetition(COMP_ID))
      .rejects.toThrow('赛事缺少阶段配置');
  });

  test('throws when competition has fewer than 3 rounds', async () => {
    mockCompetitionDRAFT();
    mockStagesWithRounds(['INDIVIDUAL_STANDARD', 'INDIVIDUAL_SHAPED']); // only 2

    await expect(orchestrator.startCompetition(COMP_ID))
      .rejects.toThrow('轮次配置不完整');
  });

  // ─── Emission payload shape ──────────────────────────────────

  test('COMPETITION_STARTED emission has all expected fields', async () => {
    mockCompetitionDRAFT();
    mockStagesWithRounds([
      'INDIVIDUAL_STANDARD',
      'INDIVIDUAL_SHAPED',
      'INDIVIDUAL_MIXED',
    ]);
    mockTeams([]);
    mockCompetitionUpdate();

    const result = await orchestrator.startCompetition(COMP_ID);

    const emission = result.emissions.find(e => e.event === 'COMPETITION_STARTED');
    expect(emission).toBeDefined();
    expect(emission.target).toBe('competition');
    expect(emission.targetId).toBe(COMP_ID);
    expect(emission.payload).toEqual({
      competitionName: 'Test Cup',
      totalRounds: 3,
      totalStages: 1,
      firstStageId: 'stage-uuid-001',
      firstStageType: 'INDIVIDUAL',
      teams: [],
      hasTeamStages: false,
    });
  });
});
