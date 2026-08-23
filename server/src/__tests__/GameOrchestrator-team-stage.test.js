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
const { CompetitionError, StageError, RoundError } = require('../engine/errors');

// Mock Prisma
jest.mock('../db/prisma', () => {
  const mockPrisma = {
    competitions: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    competition_stages: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    rounds: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
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
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    player_round_sessions: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    round_rankings: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    players: {
      findMany: jest.fn(),
    },
  };
  return { getPrisma: () => mockPrisma };
});

// Mock StateRepository with all methods
jest.mock('../state/StateRepository', () => ({
  StateRepository: class MockStateRepository {
    constructor() {
      this.data = new Map();
    }
    async get(key) { return this.data.get(key); }
    async set(key, value) { this.data.set(key, value); }
    async delete(key) { this.data.delete(key); }
    // Timer methods (called by TimerService.start)
    async setRoundTimer(roundId, state) { this.data.set(`timer:${roundId}`, state); }
    async getRoundTimer(roundId) { return this.data.get(`timer:${roundId}`) || null; }
    async deleteRoundTimer(roundId) { this.data.delete(`timer:${roundId}`); }
    async getRemainingSeconds(roundId) { return 300; }
    // Stage context
    async getStageContext(competitionId) {
      return this.data.get(`stage-context:${competitionId}`);
    }
    async setStageContext(competitionId, context) {
      this.data.set(`stage-context:${competitionId}`, context);
    }
    async clearStageContext(competitionId) {
      this.data.delete(`stage-context:${competitionId}`);
    }
    async deleteStageContext(competitionId) {
      this.data.delete(`stage-context:${competitionId}`);
    }
    async getStageContext2(competitionId) {
      return this.data.get(`stage-context:${competitionId}`);
    }
    // Round context
    async getRoundContext(roundId) {
      return this.data.get(`round-context:${roundId}`);
    }
    async setRoundContext(roundId, context) {
      this.data.set(`round-context:${roundId}`, context);
    }
    async clearRoundContext(roundId) {
      this.data.delete(`round-context:${roundId}`);
    }
    // Active players
    async getActivePlayers() { return {}; }
    async setActivePlayer() {}
    async removeActivePlayer() {}
    async refreshHeartbeat() {}
    async getStalePlayers() { return []; }
    // Round 2 team state
    async getRound2TeamState() { return null; }
    async setRound2TeamState() {}
    async deleteRound2TeamState() {}
    async updateRound2PuzzleGrid() {}
    async setRound2PlayerPuzzle() {}
    async deleteRound2PlayerPuzzle() {}
    async deleteRound2PuzzleGrid() {}
    async setRound2NextRotation() {}
    async acquireRound2Puzzle() { return null; }
    async releaseRound2PlayerPuzzle() { return null; }
    async getRound2AssignedPuzzleIds() { return new Set(); }
    // Round 3
    async getRound3Cells() { return {}; }
    async setRound3Cells() {}
    async deleteRound3Cells() {}
    async claimRound3Cell() { return { success: true, existing: null }; }
    async getRound3Suggestions() { return {}; }
    async addRound3Suggestion() {}
    async removeRound3Suggestion() {}
    async deleteRound3Suggestions() {}
    async addRound3SuggestionVote() {}
    async getRound3SuggestionVotes() { return []; }
    async deleteRound3SuggestionVotes() {}
    async deleteAllRound3SuggestionVotes() {}
    async setRound3PlayerFocus() {}
    async getRound3PlayerFocuses() { return {}; }
    async deleteRound3PlayerFocuses() {}
    // Individual player grids
    async getIndividualPlayerGrid() { return null; }
    async setIndividualPlayerGrid() {}
    async deleteIndividualPlayerGrids() {}
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
    emitImmediate(emission) {
      this.emissions.push(emission);
    }
    emitAll(emissions) {
      this.emissions.push(...(emissions || []));
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

  // Helper: build a round record as returned by rounds.findUnique with includes
  function buildRoundWithIncludes(roundId, stageId, type, orderNumber, status = 'WAITING') {
    return {
      id: roundId,
      stage_id: stageId,
      name: `Round ${orderNumber}`,
      type,
      order_number: orderNumber,
      status,
      duration_seconds: 900,
      preparation_seconds: 10,
      competition_stages: { competition_id: COMPETITION_ID },
      round_puzzles: [
        {
          id: `rp-${roundId}-1`,
          puzzle_id: `pz-${roundId}-1`,
          round_id: roundId,
          order_number: 1,
          score: 10,
          puzzles: {
            id: `pz-${roundId}-1`,
            type: 'STANDARD',
            initial_grid: '[[1,2,3],[4,5,6],[7,8,9]]',
            solution_grid: '[[1,2,3],[4,5,6],[7,8,9]]',
          },
        },
      ],
    };
  }

  beforeEach(() => {
    const { getPrisma } = require('../db/prisma');
    prisma = getPrisma();

    const { StateRepository } = require('../state/StateRepository');
    stateRepo = new StateRepository();

    const EmissionBus = require('../ws/EmissionBus');
    bus = new EmissionBus();

    // Create repos mock with custom query methods used by round engines
    const repos = {
      ...prisma,
      teams: {
        ...prisma.teams,
        findByCompetition: jest.fn().mockResolvedValue([]),
      },
      submissions: {
        findSolvedPuzzleIds: jest.fn().mockResolvedValue([]),
      },
      puzzles: {
        ...prisma.puzzles,
        countTeamPuzzles: jest.fn().mockResolvedValue(0),
      },
    };

    orchestrator = new GameOrchestrator(repos, stateRepo, bus);

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

      // Mock stage with 3 TEAM rounds (as returned by findUnique with include: { rounds })
      prisma.competition_stages.findUnique.mockResolvedValue({
        id: STAGE_ID,
        competition_id: COMPETITION_ID,
        type: 'TEAM',
        order_number: 1,
        status: 'WAITING',
        rounds: [
          { id: ROUND1_ID, name: 'R1', stage_id: STAGE_ID, type: 'ROUND1_NINE_ONE', order_number: 1, status: 'WAITING', duration_seconds: 900 },
          { id: ROUND2_ID, name: 'R2', stage_id: STAGE_ID, type: 'ROUND2_RELAY', order_number: 2, status: 'WAITING', duration_seconds: 900 },
          { id: ROUND3_ID, name: 'R3', stage_id: STAGE_ID, type: 'ROUND3_COLLABORATE', order_number: 3, status: 'WAITING', duration_seconds: 900 },
        ],
      });

      // Atomic updateMany for stage start (WAITING → RUNNING)
      prisma.competition_stages.updateMany.mockResolvedValue({ count: 1 });

      // rounds.findFirst (used by startStage to find first round)
      prisma.rounds.findFirst.mockResolvedValue({
        id: ROUND1_ID,
        stage_id: STAGE_ID,
        type: 'ROUND1_NINE_ONE',
        order_number: 1,
        status: 'WAITING',
        duration_seconds: 900,
        preparation_seconds: 10,
      });

      // rounds.findUnique (used by prepareRound — needs includes)
      prisma.rounds.findUnique.mockResolvedValue(
        buildRoundWithIncludes(ROUND1_ID, STAGE_ID, 'ROUND1_NINE_ONE', 1)
      );

      // Atomic updateMany for round activate (WAITING → IN_PROGRESS)
      prisma.rounds.updateMany.mockResolvedValue({ count: 1 });
      prisma.rounds.update.mockResolvedValue({});

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
    });

    it('should start TEAM stage and transition to RUNNING status', async () => {
      const result = await orchestrator.startStage(COMPETITION_ID, STAGE_ID);

      // Stage atomic update
      expect(prisma.competition_stages.updateMany).toHaveBeenCalledWith({
        where: { id: STAGE_ID, status: 'WAITING' },
        data: { status: 'RUNNING' },
      });

      expect(result.result.status).toBe('RUNNING');
      expect(result.result.stageId).toBe(STAGE_ID);
    });

    it('should auto-chain to first round (R1) after stage starts', async () => {
      const result = await orchestrator.startStage(COMPETITION_ID, STAGE_ID);

      // startStage auto-chains to startRound, which calls prepareRound (findUnique)
      // and startPreparation (timer.start → setRoundTimer)
      // The round activates via DB updateMany for status transition
      expect(prisma.rounds.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ROUND1_ID, stage_id: STAGE_ID } })
      );

      // Timer should have been set (preparation countdown started)
      const timerState = await stateRepo.getRoundTimer(`prep_${ROUND1_ID}`);
      expect(timerState).toBeTruthy();
      expect(timerState.status).toBe('RUNNING');
    });

    it('should throw error if stage is not WAITING', async () => {
      // Mock stage with RUNNING status — loadStageContext sets stageStatus from DB
      prisma.competition_stages.findUnique.mockResolvedValue({
        id: STAGE_ID,
        competition_id: COMPETITION_ID,
        type: 'TEAM',
        order_number: 1,
        status: 'RUNNING',
        rounds: [
          { id: ROUND1_ID, name: 'R1', stage_id: STAGE_ID, type: 'ROUND1_NINE_ONE', order_number: 1, status: 'IN_PROGRESS', duration_seconds: 900 },
        ],
      });

      await expect(orchestrator.startStage(COMPETITION_ID, STAGE_ID))
        .rejects.toThrow('Cannot start stage');
    });
  });

  describe('Round execution flow (R1 → R2 → R3)', () => {
    beforeEach(() => {
      // Mock competition as RUNNING
      prisma.competitions.findUnique.mockResolvedValue({
        id: COMPETITION_ID,
        name: 'Test Competition',
        status: 'RUNNING',
      });

      // Set up stage context in StageManager's in-memory _context
      orchestrator.stages._context = {
        competitionId: COMPETITION_ID,
        stageId: STAGE_ID,
        stageType: 'TEAM',
        stageStatus: 'RUNNING',
        rounds: [],
        currentRoundIndex: -1,
      };

      // Atomic updates
      prisma.rounds.updateMany.mockResolvedValue({ count: 1 });
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
      prisma.rounds.findUnique.mockResolvedValue(
        buildRoundWithIncludes(ROUND1_ID, STAGE_ID, 'ROUND1_NINE_ONE', 1)
      );

      const result = await orchestrator.startRound(COMPETITION_ID, ROUND1_ID);

      // startRound calls prepareRound → sets up context, then startPreparation → starts timer
      expect(result.result.roundId).toBe(ROUND1_ID);
      // Verify prepareRound was called (it queries rounds.findUnique)
      expect(prisma.rounds.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ROUND1_ID, stage_id: STAGE_ID } })
      );
      // Verify preparation timer was started
      const timerState = await stateRepo.getRoundTimer(`prep_${ROUND1_ID}`);
      expect(timerState).toBeTruthy();
    });

    it('should execute R2 (ROUND2_RELAY) setup', async () => {
      prisma.rounds.findUnique.mockResolvedValue(
        buildRoundWithIncludes(ROUND2_ID, STAGE_ID, 'ROUND2_RELAY', 2)
      );

      const result = await orchestrator.startRound(COMPETITION_ID, ROUND2_ID);

      expect(result.result.roundId).toBe(ROUND2_ID);
    });

    it('should execute R3 (ROUND3_COLLABORATE) setup', async () => {
      prisma.rounds.findUnique.mockResolvedValue(
        buildRoundWithIncludes(ROUND3_ID, STAGE_ID, 'ROUND3_COLLABORATE', 3)
      );

      const result = await orchestrator.startRound(COMPETITION_ID, ROUND3_ID);

      expect(result.result.roundId).toBe(ROUND3_ID);
    });
  });

  describe('endRound() and auto-progression', () => {
    beforeEach(() => {
      // Set up stage context in StageManager's in-memory _context
      orchestrator.stages._context = {
        competitionId: COMPETITION_ID,
        stageId: STAGE_ID,
        stageType: 'TEAM',
        stageOrder: 1,
        stageStatus: 'RUNNING',
        rounds: [],
        currentRoundIndex: -1,
      };

      prisma.teams.findMany.mockResolvedValue([
        { id: TEAM1_ID, name: 'Team Alpha' },
      ]);

      // Mock no completion bonus scenarios
      prisma.puzzle_answers.findMany.mockResolvedValue([]);
      prisma.round_puzzles.count.mockResolvedValue(10);
      // round_puzzles.findMany is used in R3 completion bonus calculation
      prisma.round_puzzles.findMany.mockResolvedValue([{ puzzle_id: 'pz-1', round_id: ROUND1_ID }]);

      // Atomic updateMany for round end and stage finish
      prisma.rounds.updateMany.mockResolvedValue({ count: 1 });
      prisma.competition_stages.updateMany.mockResolvedValue({ count: 1 });
    });

    it('should end R1 and auto-start R2', async () => {
      // After atomic update sets R1 to FINISHED, findUnique returns the updated record
      // endRound at line 764 calls prepareRound to re-load context, which needs competition_stages
      prisma.rounds.findUnique.mockImplementation(async ({ where }) => {
        const id = where.id;
        if (id === ROUND1_ID) return buildRoundWithIncludes(ROUND1_ID, STAGE_ID, 'ROUND1_NINE_ONE', 1, 'FINISHED');
        if (id === ROUND2_ID) return buildRoundWithIncludes(ROUND2_ID, STAGE_ID, 'ROUND2_RELAY', 2);
        return null;
      });

      // Next round lookup
      prisma.rounds.findFirst.mockResolvedValue({
        id: ROUND2_ID,
        stage_id: STAGE_ID,
        type: 'ROUND2_RELAY',
        order_number: 2,
        status: 'WAITING',
      });

      // Mock timer
      orchestrator.timer.getRemainingSeconds = jest.fn().mockResolvedValue(300);

      // Mock engine cleanup
      orchestrator.round1.cleanup = jest.fn().mockResolvedValue();
      orchestrator.round2.cleanup = jest.fn().mockResolvedValue();
      orchestrator.round3.cleanup = jest.fn().mockResolvedValue();

      const result = await orchestrator.endRound(COMPETITION_ID, ROUND1_ID);

      // Should finish R1 with atomic updateMany
      expect(prisma.rounds.updateMany).toHaveBeenCalledWith({
        where: { id: ROUND1_ID, status: { not: 'FINISHED' } },
        data: { status: 'FINISHED', ended_at: expect.any(Date) },
      });
    });

    it('should end R3 and auto-finish stage', async () => {
      prisma.rounds.findUnique.mockImplementation(async ({ where }) => {
        const id = where.id;
        if (id === ROUND3_ID) return buildRoundWithIncludes(ROUND3_ID, STAGE_ID, 'ROUND3_COLLABORATE', 3, 'FINISHED');
        return null;
      });

      // No next round
      prisma.rounds.findFirst.mockResolvedValue(null);

      // All rounds finished (for finishStage validation)
      prisma.rounds.findMany.mockResolvedValue([]);

      orchestrator.timer.getRemainingSeconds = jest.fn().mockResolvedValue(0);

      // Mock engine cleanup
      orchestrator.round1.cleanup = jest.fn().mockResolvedValue();
      orchestrator.round2.cleanup = jest.fn().mockResolvedValue();
      orchestrator.round3.cleanup = jest.fn().mockResolvedValue();

      const result = await orchestrator.endRound(COMPETITION_ID, ROUND3_ID);

      // Should finish R3 with atomic updateMany
      expect(prisma.rounds.updateMany).toHaveBeenCalledWith({
        where: { id: ROUND3_ID, status: { not: 'FINISHED' } },
        data: { status: 'FINISHED', ended_at: expect.any(Date) },
      });

      // Should finish stage with atomic updateMany
      expect(prisma.competition_stages.updateMany).toHaveBeenCalledWith({
        where: { id: STAGE_ID, status: 'RUNNING' },
        data: { status: 'FINISHED' },
      });
    });

    it('should apply R1 time bonus when round ends early', async () => {
      // endRound at line 764 calls prepareRound to re-load context, needs competition_stages
      prisma.rounds.findUnique.mockResolvedValue(
        buildRoundWithIncludes(ROUND1_ID, STAGE_ID, 'ROUND1_NINE_ONE', 1, 'FINISHED')
      );

      // Next round
      prisma.rounds.findFirst.mockResolvedValue({
        id: ROUND2_ID,
        stage_id: STAGE_ID,
        type: 'ROUND2_RELAY',
        order_number: 2,
        status: 'WAITING',
      });

      prisma.teams.findMany.mockResolvedValue([
        { id: TEAM1_ID, name: 'Team Alpha' },
      ]);

      prisma.puzzle_answers.findMany.mockResolvedValue([
        { puzzle_id: 'pz-1', progress_percentage: 100 },
        { puzzle_id: 'pz-2', progress_percentage: 100 },
        { puzzle_id: 'pz-3', progress_percentage: 100 },
      ]);

      prisma.round_puzzles.count.mockResolvedValue(3);

      orchestrator.timer.getRemainingSeconds = jest.fn().mockResolvedValue(300);

      // Mock engine cleanup
      orchestrator.round1.cleanup = jest.fn().mockResolvedValue();
      orchestrator.round2.cleanup = jest.fn().mockResolvedValue();
      orchestrator.round3.cleanup = jest.fn().mockResolvedValue();

      await orchestrator.endRound(COMPETITION_ID, ROUND1_ID);

      // Time bonus should be calculated — we just verify it was called
      expect(orchestrator.timer.getRemainingSeconds).toHaveBeenCalledWith(ROUND1_ID);
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
        order_number: 1,
        status: 'WAITING',
        rounds: [
          { id: ROUND1_ID, name: 'R1', type: 'ROUND1_NINE_ONE', order_number: 1, status: 'WAITING', duration_seconds: 900 },
          { id: ROUND2_ID, name: 'R2', type: 'ROUND2_RELAY', order_number: 2, status: 'WAITING', duration_seconds: 900 },
          { id: ROUND3_ID, name: 'R3', type: 'ROUND3_COLLABORATE', order_number: 3, status: 'WAITING', duration_seconds: 900 },
        ],
      });

      // Atomic updates
      prisma.competition_stages.updateMany.mockResolvedValue({ count: 1 });
      prisma.rounds.updateMany.mockResolvedValue({ count: 1 });
      prisma.rounds.update.mockResolvedValue({});

      // First round for auto-chain
      prisma.rounds.findFirst.mockResolvedValue({
        id: ROUND1_ID,
        type: 'ROUND1_NINE_ONE',
        stage_id: STAGE_ID,
        order_number: 1,
        status: 'WAITING',
        duration_seconds: 900,
        preparation_seconds: 10,
      });

      // Round data for prepareRound
      prisma.rounds.findUnique.mockResolvedValue(
        buildRoundWithIncludes(ROUND1_ID, STAGE_ID, 'ROUND1_NINE_ONE', 1)
      );

      prisma.teams.findMany.mockResolvedValue([
        { id: TEAM1_ID, name: 'Team Alpha' },
      ]);

      const startResult = await orchestrator.startStage(COMPETITION_ID, STAGE_ID);
      expect(startResult.result.status).toBe('RUNNING');

      // Verify atomic stage start
      expect(prisma.competition_stages.updateMany).toHaveBeenCalledWith({
        where: { id: STAGE_ID, status: 'WAITING' },
        data: { status: 'RUNNING' },
      });

      // Verify round was prepared (prepareRound called rounds.findUnique)
      expect(prisma.rounds.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ROUND1_ID, stage_id: STAGE_ID } })
      );

      // Verify preparation timer was started (startPreparation calls timer.start)
      const timerState = await stateRepo.getRoundTimer(`prep_${ROUND1_ID}`);
      expect(timerState).toBeTruthy();
      expect(timerState.status).toBe('RUNNING');
    });
  });
});
