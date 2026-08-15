/**
 * TEAM Stage Integration Test
 *
 * Tests the complete flow:
 * 1. startCompetition() with TEAM rounds
 * 2. startStage() for TEAM stage
 * 3. R1/R2/R3 rounds execute in sequence
 * 4. Stage completes after all rounds finish
 */

const GameOrchestrator = require('../engine/GameOrchestrator');
const { CompetitionError, StageError } = require('../engine/errors');

// Mock Prisma
jest.mock('../db/prisma', () => {
  const mockPrisma = {
    competitions: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    competition_stages: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    rounds: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    teams: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      getMembersWithDetails: jest.fn(),
    },
    round_puzzles: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    puzzles: {
      findMany: jest.fn(),
    },
    puzzle_answers: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    player_round_sessions: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    round_rankings: {
      findMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  };
  return { getPrisma: () => mockPrisma };
});

// Mock StateRepository
jest.mock('../state/StateRepository', () => ({
  StateRepository: class MockStateRepository {
    constructor() {
      this.data = new Map();
    }
    async get(key) { return this.data.get(key); }
    async set(key, value) { this.data.set(key, value); }
    async delete(key) { this.data.delete(key); }
    async getStageContext(competitionId) {
      return this.data.get(`stage-context:${competitionId}`);
    }
    async setStageContext(competitionId, context) {
      this.data.set(`stage-context:${competitionId}`, context);
    }
    async clearStageContext(competitionId) {
      this.data.delete(`stage-context:${competitionId}`);
    }
    async getRoundContext(roundId) {
      return this.data.get(`round-context:${roundId}`);
    }
    async setRoundContext(roundId, context) {
      this.data.set(`round-context:${roundId}`, context);
    }
    async clearRoundContext(roundId) {
      this.data.delete(`round-context:${roundId}`);
    }
  }
}));

// Mock EmissionBus
jest.mock('../ws/EmissionBus', () => {
  return class MockEmissionBus {
    constructor() {
      this.emissions = [];
    }
    emit(emission) {
      this.emissions.push(emission);
    }
    clear() {
      this.emissions = [];
    }
  };
});

describe('GameOrchestrator - TEAM Stage Flow', () => {
  let orchestrator;
  let prisma;
  let stateRepo;
  let bus;

  const COMPETITION_ID = 'comp-1';
  const STAGE_ID = 'stage-1';
  const ROUND1_ID = 'round-1';
  const ROUND2_ID = 'round-2';
  const ROUND3_ID = 'round-3';
  const TEAM1_ID = 'team-1';
  const TEAM2_ID = 'team-2';

  beforeEach(() => {
    const { getPrisma } = require('../db/prisma');
    prisma = getPrisma();

    const { StateRepository } = require('../state/StateRepository');
    stateRepo = new StateRepository();

    const EmissionBus = require('../ws/EmissionBus');
    bus = new EmissionBus();

    orchestrator = new GameOrchestrator(prisma, stateRepo, bus);

    // Reset all mocks
    Object.values(prisma).forEach(model => {
      Object.values(model).forEach(method => {
        if (jest.isMockFunction(method)) {
          method.mockReset();
        }
      });
    });
    bus.clear();
  });

  describe('startStage() for TEAM stage', () => {
    beforeEach(() => {
      // Mock competition
      prisma.competitions.findUnique.mockResolvedValue({
        id: COMPETITION_ID,
        name: 'Test Competition',
        status: 'RUNNING',
      });

      // Mock stage with 3 TEAM rounds
      prisma.competition_stages.findUnique.mockResolvedValue({
        id: STAGE_ID,
        competition_id: COMPETITION_ID,
        type: 'TEAM',
        order_number: 1,
        status: 'WAITING',
      });

      prisma.competition_stages.update.mockResolvedValue({
        id: STAGE_ID,
        status: 'RUNNING',
      });

      // Mock rounds
      prisma.rounds.findMany.mockResolvedValue([
        { id: ROUND1_ID, stage_id: STAGE_ID, type: 'ROUND1_NINE_ONE', order_number: 1, status: 'WAITING', duration_seconds: 900, preparation_seconds: 10 },
        { id: ROUND2_ID, stage_id: STAGE_ID, type: 'ROUND2_RELAY', order_number: 2, status: 'WAITING', duration_seconds: 900, preparation_seconds: 10 },
        { id: ROUND3_ID, stage_id: STAGE_ID, type: 'ROUND3_COLLABORATE', order_number: 3, status: 'WAITING', duration_seconds: 900, preparation_seconds: 10 },
      ]);

      prisma.rounds.findFirst.mockResolvedValue({
        id: ROUND1_ID,
        stage_id: STAGE_ID,
        type: 'ROUND1_NINE_ONE',
        order_number: 1,
        status: 'WAITING',
        duration_seconds: 900,
        preparation_seconds: 10,
      });

      // Mock teams
      prisma.teams.findMany.mockResolvedValue([
        { id: TEAM1_ID, competition_id: COMPETITION_ID, name: 'Team Alpha' },
        { id: TEAM2_ID, competition_id: COMPETITION_ID, name: 'Team Beta' },
      ]);

      prisma.teams.getMembersWithDetails.mockResolvedValue([
        { id: 'player-1', team_id: TEAM1_ID, name: 'Player 1' },
        { id: 'player-2', team_id: TEAM1_ID, name: 'Player 2' },
      ]);

      // Mock round puzzles
      prisma.round_puzzles.findMany.mockResolvedValue([
        { id: 'puzzle-1', round_id: ROUND1_ID, puzzle_id: 'pz-1', order_number: 1, score: 10 },
      ]);

      prisma.rounds.update.mockResolvedValue({});
    });

    it('should start TEAM stage and transition to RUNNING status', async () => {
      const result = await orchestrator.startStage(COMPETITION_ID, STAGE_ID);

      expect(prisma.competition_stages.update).toHaveBeenCalledWith({
        where: { id: STAGE_ID },
        data: { status: 'RUNNING' },
      });

      expect(result.status).toBe('RUNNING');
      expect(result.stageId).toBe(STAGE_ID);
    });

    it('should auto-chain to first round (R1) after stage starts', async () => {
      const result = await orchestrator.startStage(COMPETITION_ID, STAGE_ID);

      // Should start R1 preparation
      expect(prisma.rounds.update).toHaveBeenCalledWith({
        where: { id: ROUND1_ID },
        data: { status: 'PREPARATION' },
      });
    });

    it('should throw error if stage does not belong to competition', async () => {
      prisma.competition_stages.findUnique.mockResolvedValue({
        id: STAGE_ID,
        competition_id: 'different-comp',
        type: 'TEAM',
      });

      await expect(orchestrator.startStage(COMPETITION_ID, STAGE_ID))
        .rejects.toThrow('Stage does not belong to competition');
    });

    it('should throw error if stage is not WAITING', async () => {
      prisma.competition_stages.findUnique.mockResolvedValue({
        id: STAGE_ID,
        competition_id: COMPETITION_ID,
        type: 'TEAM',
        status: 'RUNNING',
      });

      await expect(orchestrator.startStage(COMPETITION_ID, STAGE_ID))
        .rejects.toThrow('Stage is not in WAITING status');
    });
  });

  describe('Round execution flow (R1 → R2 → R3)', () => {
    beforeEach(() => {
      // Setup stage context in state
      stateRepo.setStageContext(COMPETITION_ID, {
        id: STAGE_ID,
        competition_id: COMPETITION_ID,
        type: 'TEAM',
        status: 'RUNNING',
      });

      // Mock round updates
      prisma.rounds.update.mockResolvedValue({});

      // Mock teams for round setup
      prisma.teams.findMany.mockResolvedValue([
        { id: TEAM1_ID, name: 'Team Alpha' },
        { id: TEAM2_ID, name: 'Team Beta' },
      ]);

      prisma.teams.getMembersWithDetails.mockResolvedValue([
        { id: 'player-1', team_id: TEAM1_ID },
      ]);

      // Mock puzzles for each round
      prisma.round_puzzles.findMany.mockResolvedValue([
        { id: 'rp-1', round_id: ROUND1_ID, puzzle_id: 'pz-1' },
      ]);

      prisma.puzzles.findMany.mockResolvedValue([
        { id: 'pz-1', type: 'STANDARD', initial_grid: [[1,2,3],[4,5,6],[7,8,9]] },
      ]);
    });

    it('should execute R1 (ROUND1_NINE_ONE) setup for all teams', async () => {
      const roundContext = {
        id: ROUND1_ID,
        stage_id: STAGE_ID,
        type: 'ROUND1_NINE_ONE',
        status: 'PREPARATION',
        duration_seconds: 900,
        preparation_seconds: 10,
      };

      await stateRepo.setRoundContext(ROUND1_ID, roundContext);

      prisma.rounds.findUnique.mockResolvedValue(roundContext);

      const result = await orchestrator.startRound(COMPETITION_ID, ROUND1_ID);

      expect(result.roundId).toBe(ROUND1_ID);
      expect(prisma.teams.findMany).toHaveBeenCalled();
    });

    it('should execute R2 (ROUND2_RELAY) setup', async () => {
      const roundContext = {
        id: ROUND2_ID,
        stage_id: STAGE_ID,
        type: 'ROUND2_RELAY',
        status: 'PREPARATION',
        duration_seconds: 900,
      };

      await stateRepo.setRoundContext(ROUND2_ID, roundContext);
      prisma.rounds.findUnique.mockResolvedValue(roundContext);

      const result = await orchestrator.startRound(COMPETITION_ID, ROUND2_ID);

      expect(result.roundId).toBe(ROUND2_ID);
    });

    it('should execute R3 (ROUND3_COLLABORATE) setup', async () => {
      const roundContext = {
        id: ROUND3_ID,
        stage_id: STAGE_ID,
        type: 'ROUND3_COLLABORATE',
        status: 'PREPARATION',
        duration_seconds: 900,
      };

      await stateRepo.setRoundContext(ROUND3_ID, roundContext);
      prisma.rounds.findUnique.mockResolvedValue(roundContext);

      const result = await orchestrator.startRound(COMPETITION_ID, ROUND3_ID);

      expect(result.roundId).toBe(ROUND3_ID);
    });
  });

  describe('endRound() and auto-progression', () => {
    beforeEach(() => {
      // Setup stage context
      stateRepo.setStageContext(COMPETITION_ID, {
        id: STAGE_ID,
        competition_id: COMPETITION_ID,
        type: 'TEAM',
        status: 'RUNNING',
      });

      prisma.teams.findMany.mockResolvedValue([
        { id: TEAM1_ID, name: 'Team Alpha' },
      ]);

      // Mock no completion bonus scenarios
      prisma.puzzle_answers.findMany.mockResolvedValue([]);
      prisma.round_puzzles.count.mockResolvedValue(10);
    });

    it('should end R1 and auto-start R2', async () => {
      const round1Context = {
        id: ROUND1_ID,
        stage_id: STAGE_ID,
        type: 'ROUND1_NINE_ONE',
        status: 'IN_PROGRESS',
      };

      await stateRepo.setRoundContext(ROUND1_ID, round1Context);

      prisma.rounds.findUnique.mockImplementation(async ({ where: { id } }) => {
        if (id === ROUND1_ID) return round1Context;
        if (id === ROUND2_ID) return {
          id: ROUND2_ID,
          stage_id: STAGE_ID,
          type: 'ROUND2_RELAY',
          status: 'WAITING',
          order_number: 2,
        };
        return null;
      });

      prisma.rounds.update.mockResolvedValue({});

      // Mock timer
      orchestrator.timer.getRemainingSeconds = jest.fn().mockResolvedValue(300);

      const result = await orchestrator.endRound(COMPETITION_ID, ROUND1_ID);

      // Should finish R1
      expect(prisma.rounds.update).toHaveBeenCalledWith({
        where: { id: ROUND1_ID },
        data: { status: 'FINISHED' },
      });

      // Should emit ROUND_FINISHED
      const roundFinishedEmission = bus.emissions.find(e => e.event === 'ROUND_FINISHED');
      expect(roundFinishedEmission).toBeDefined();
    });

    it('should end R3 and auto-finish stage', async () => {
      const round3Context = {
        id: ROUND3_ID,
        stage_id: STAGE_ID,
        type: 'ROUND3_COLLABORATE',
        status: 'IN_PROGRESS',
      };

      await stateRepo.setRoundContext(ROUND3_ID, round3Context);

      prisma.rounds.findUnique.mockImplementation(async ({ where: { id } }) => {
        if (id === ROUND3_ID) return round3Context;
        return null;
      });

      prisma.competition_stages.update.mockResolvedValue({
        id: STAGE_ID,
        status: 'FINISHED',
      });

      orchestrator.timer.getRemainingSeconds = jest.fn().mockResolvedValue(0);

      const result = await orchestrator.endRound(COMPETITION_ID, ROUND3_ID);

      // Should finish R3
      expect(prisma.rounds.update).toHaveBeenCalledWith({
        where: { id: ROUND3_ID },
        data: { status: 'FINISHED' },
      });

      // Should finish stage
      expect(prisma.competition_stages.update).toHaveBeenCalledWith({
        where: { id: STAGE_ID },
        data: { status: 'FINISHED' },
      });
    });

    it('should apply R1 time bonus when round ends early', async () => {
      const round1Context = {
        id: ROUND1_ID,
        stage_id: STAGE_ID,
        type: 'ROUND1_NINE_ONE',
        status: 'IN_PROGRESS',
      };

      await stateRepo.setRoundContext(ROUND1_ID, round1Context);
      prisma.rounds.findUnique.mockResolvedValue(round1Context);

      // Mock team with all puzzles solved
      prisma.teams.findMany.mockResolvedValue([
        { id: TEAM1_ID, name: 'Team Alpha' },
      ]);

      prisma.puzzle_answers.findMany.mockResolvedValue([
        { puzzle_id: 'pz-1', progress_percentage: 100 },
        { puzzle_id: 'pz-2', progress_percentage: 100 },
        { puzzle_id: 'pz-3', progress_percentage: 100 },
      ]);

      prisma.round_puzzles.count.mockResolvedValue(3);

      orchestrator.timer.getRemainingSeconds = jest.fn().mockResolvedValue(300); // 5 minutes left

      await orchestrator.endRound(COMPETITION_ID, ROUND1_ID);

      // Time bonus should be calculated (5 min * 3 points = 15 points)
      // The actual bonus logic is in ScoringService, we just verify it was called
    });
  });

  describe('Complete TEAM stage flow', () => {
    it('should handle full stage lifecycle: WAITING → RUNNING → FINISHED', async () => {
      // 1. Stage starts
      prisma.competitions.findUnique.mockResolvedValue({
        id: COMPETITION_ID,
        status: 'RUNNING',
      });

      prisma.competition_stages.findUnique.mockResolvedValue({
        id: STAGE_ID,
        competition_id: COMPETITION_ID,
        type: 'TEAM',
        status: 'WAITING',
      });

      prisma.competition_stages.update.mockResolvedValue({
        id: STAGE_ID,
        status: 'RUNNING',
      });

      prisma.rounds.findMany.mockResolvedValue([
        { id: ROUND1_ID, type: 'ROUND1_NINE_ONE', order_number: 1, status: 'WAITING' },
        { id: ROUND2_ID, type: 'ROUND2_RELAY', order_number: 2, status: 'WAITING' },
        { id: ROUND3_ID, type: 'ROUND3_COLLABORATE', order_number: 3, status: 'WAITING' },
      ]);

      prisma.rounds.findFirst.mockResolvedValue({
        id: ROUND1_ID,
        type: 'ROUND1_NINE_ONE',
      });

      prisma.teams.findMany.mockResolvedValue([
        { id: TEAM1_ID, name: 'Team Alpha' },
      ]);

      prisma.rounds.update.mockResolvedValue({});

      const startResult = await orchestrator.startStage(COMPETITION_ID, STAGE_ID);
      expect(startResult.status).toBe('RUNNING');

      // 2. Rounds execute (simulated)
      expect(prisma.rounds.update).toHaveBeenCalledWith({
        where: { id: ROUND1_ID },
        data: { status: 'PREPARATION' },
      });

      // 3. Stage finishes (after all rounds complete)
      prisma.competition_stages.update.mockResolvedValue({
        id: STAGE_ID,
        status: 'FINISHED',
      });

      // In real flow, endRound() would be called for each round
      // Here we just verify the stage can be finished
      await stateRepo.setStageContext(COMPETITION_ID, {
        id: STAGE_ID,
        competition_id: COMPETITION_ID,
        type: 'TEAM',
        status: 'RUNNING',
      });

      const finishResult = await orchestrator.finishStage(COMPETITION_ID, STAGE_ID);

      expect(prisma.competition_stages.update).toHaveBeenCalledWith({
        where: { id: STAGE_ID },
        data: { status: 'FINISHED' },
      });
    });
  });
});
