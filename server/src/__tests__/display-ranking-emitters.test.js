/**
 * Display ranking mode emitter tests — emitRoundRanking, emitStageRanking, emitFinalRanking
 *
 * Test categories:
 * 1. emitRoundRanking — sets ROUND_RANKING mode, emits DISPLAY_MODE_CHANGED + RANKING_UPDATE
 * 2. emitStageRanking — sets STAGE_RANKING mode, emits DISPLAY_MODE_CHANGED + RANKING_UPDATE
 * 3. emitFinalRanking — sets FINAL_RANKING mode, emits DISPLAY_MODE_CHANGED + RANKING_UPDATE
 * 4. Error handling — gracefully handles database failures
 */

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

const mockBus = {
  emitImmediate: jest.fn(),
};

describe('DisplayManager Ranking Mode Emitters', () => {
  let displayManager;

  beforeEach(() => {
    jest.clearAllMocks();
    displayManager = new DisplayManager({}, mockBus);
  });

  describe('emitRoundRanking(competitionId, categoryId)', () => {
    const competitionId = 'comp-uuid';

    test('sets display_mode to ROUND_RANKING', async () => {
      mockPrisma.competitions.update.mockResolvedValue({});
      mockPrisma.competitions.findUnique.mockResolvedValue({
        id: competitionId,
        name: 'Test',
        status: 'RUNNING',
        display_mode: 'DEFAULT',
        competition_stages: [],
      });
      mockPrisma.final_rankings.findMany.mockResolvedValue([]);
      mockPrisma.categories.findMany.mockResolvedValue([]);

      await displayManager.emitRoundRanking(competitionId);

      expect(mockPrisma.competitions.update).toHaveBeenCalledWith({
        where: { id: competitionId },
        data: { display_mode: 'ROUND_RANKING' },
      });
    });

    test('emits DISPLAY_MODE_CHANGED with ROUND_RANKING mode', async () => {
      mockPrisma.competitions.update.mockResolvedValue({});
      mockPrisma.competitions.findUnique.mockResolvedValue({
        id: competitionId,
        name: 'Test',
        status: 'RUNNING',
        display_mode: 'DEFAULT',
        competition_stages: [],
      });
      mockPrisma.final_rankings.findMany.mockResolvedValue([]);
      mockPrisma.categories.findMany.mockResolvedValue([]);

      await displayManager.emitRoundRanking(competitionId);

      expect(mockBus.emitImmediate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: 'display',
          targetId: competitionId,
          event: 'DISPLAY_MODE_CHANGED',
          payload: expect.objectContaining({
            mode: 'ROUND_RANKING',
          }),
        })
      );
    });

    test('emits RANKING_UPDATE with snapshot', async () => {
      mockPrisma.competitions.update.mockResolvedValue({});
      mockPrisma.competitions.findUnique.mockResolvedValue({
        id: competitionId,
        name: 'Test',
        status: 'RUNNING',
        display_mode: 'DEFAULT',
        competition_stages: [],
      });
      mockPrisma.final_rankings.findMany.mockResolvedValue([]);
      mockPrisma.categories.findMany.mockResolvedValue([]);

      await displayManager.emitRoundRanking(competitionId);

      expect(mockBus.emitImmediate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: 'display',
          targetId: competitionId,
          event: 'RANKING_UPDATE',
          payload: expect.objectContaining({
            snapshot: expect.any(Object),
          }),
        })
      );
    });

    test('passes categoryId to ranking snapshot', async () => {
      const categoryId = 'cat-uuid';
      mockPrisma.competitions.update.mockResolvedValue({});
      mockPrisma.competitions.findUnique.mockResolvedValue({
        id: competitionId,
        name: 'Test',
        status: 'RUNNING',
        display_mode: 'DEFAULT',
        competition_stages: [],
      });
      mockPrisma.final_rankings.findMany.mockResolvedValue([]);
      mockPrisma.categories.findMany.mockResolvedValue([]);

      await displayManager.emitRoundRanking(competitionId, categoryId);

      expect(mockBus.emitImmediate).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'RANKING_UPDATE',
          payload: expect.objectContaining({
            categoryId,
          }),
        })
      );
    });
  });

  describe('emitStageRanking(competitionId, categoryId)', () => {
    const competitionId = 'comp-uuid';

    test('sets display_mode to STAGE_RANKING', async () => {
      mockPrisma.competitions.update.mockResolvedValue({});
      mockPrisma.competitions.findUnique.mockResolvedValue({
        id: competitionId,
        name: 'Test',
        status: 'RUNNING',
        display_mode: 'DEFAULT',
        competition_stages: [],
      });
      mockPrisma.final_rankings.findMany.mockResolvedValue([]);
      mockPrisma.categories.findMany.mockResolvedValue([]);

      await displayManager.emitStageRanking(competitionId);

      expect(mockPrisma.competitions.update).toHaveBeenCalledWith({
        where: { id: competitionId },
        data: { display_mode: 'STAGE_RANKING' },
      });
    });

    test('emits DISPLAY_MODE_CHANGED with STAGE_RANKING mode', async () => {
      mockPrisma.competitions.update.mockResolvedValue({});
      mockPrisma.competitions.findUnique.mockResolvedValue({
        id: competitionId,
        name: 'Test',
        status: 'RUNNING',
        display_mode: 'DEFAULT',
        competition_stages: [],
      });
      mockPrisma.final_rankings.findMany.mockResolvedValue([]);
      mockPrisma.categories.findMany.mockResolvedValue([]);

      await displayManager.emitStageRanking(competitionId);

      expect(mockBus.emitImmediate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: 'display',
          targetId: competitionId,
          event: 'DISPLAY_MODE_CHANGED',
          payload: expect.objectContaining({
            mode: 'STAGE_RANKING',
          }),
        })
      );
    });

    test('emits RANKING_UPDATE with snapshot', async () => {
      mockPrisma.competitions.update.mockResolvedValue({});
      mockPrisma.competitions.findUnique.mockResolvedValue({
        id: competitionId,
        name: 'Test',
        status: 'RUNNING',
        display_mode: 'DEFAULT',
        competition_stages: [],
      });
      mockPrisma.final_rankings.findMany.mockResolvedValue([]);
      mockPrisma.categories.findMany.mockResolvedValue([]);

      await displayManager.emitStageRanking(competitionId);

      expect(mockBus.emitImmediate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: 'display',
          targetId: competitionId,
          event: 'RANKING_UPDATE',
          payload: expect.objectContaining({
            snapshot: expect.any(Object),
          }),
        })
      );
    });
  });

  describe('emitFinalRanking(competitionId, categoryId)', () => {
    const competitionId = 'comp-uuid';

    test('sets display_mode to FINAL_RANKING', async () => {
      mockPrisma.competitions.update.mockResolvedValue({});
      mockPrisma.competitions.findUnique.mockResolvedValue({
        id: competitionId,
        name: 'Test',
        status: 'FINISHED',
        display_mode: 'DEFAULT',
        competition_stages: [],
      });
      mockPrisma.final_rankings.findMany.mockResolvedValue([]);
      mockPrisma.categories.findMany.mockResolvedValue([]);

      await displayManager.emitFinalRanking(competitionId);

      expect(mockPrisma.competitions.update).toHaveBeenCalledWith({
        where: { id: competitionId },
        data: { display_mode: 'FINAL_RANKING' },
      });
    });

    test('emits DISPLAY_MODE_CHANGED with FINAL_RANKING mode', async () => {
      mockPrisma.competitions.update.mockResolvedValue({});
      mockPrisma.competitions.findUnique.mockResolvedValue({
        id: competitionId,
        name: 'Test',
        status: 'FINISHED',
        display_mode: 'DEFAULT',
        competition_stages: [],
      });
      mockPrisma.final_rankings.findMany.mockResolvedValue([]);
      mockPrisma.categories.findMany.mockResolvedValue([]);

      await displayManager.emitFinalRanking(competitionId);

      expect(mockBus.emitImmediate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: 'display',
          targetId: competitionId,
          event: 'DISPLAY_MODE_CHANGED',
          payload: expect.objectContaining({
            mode: 'FINAL_RANKING',
          }),
        })
      );
    });

    test('emits RANKING_UPDATE with snapshot', async () => {
      mockPrisma.competitions.update.mockResolvedValue({});
      mockPrisma.competitions.findUnique.mockResolvedValue({
        id: competitionId,
        name: 'Test',
        status: 'FINISHED',
        display_mode: 'DEFAULT',
        competition_stages: [],
      });
      mockPrisma.final_rankings.findMany.mockResolvedValue([]);
      mockPrisma.categories.findMany.mockResolvedValue([]);

      await displayManager.emitFinalRanking(competitionId);

      expect(mockBus.emitImmediate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: 'display',
          targetId: competitionId,
          event: 'RANKING_UPDATE',
          payload: expect.objectContaining({
            snapshot: expect.any(Object),
          }),
        })
      );
    });
  });

  describe('Error handling', () => {
    const competitionId = 'comp-uuid';

    test('emitRoundRanking handles database errors gracefully', async () => {
      mockPrisma.competitions.update.mockRejectedValue(new Error('DB error'));

      // Should not throw
      await expect(displayManager.emitRoundRanking(competitionId)).resolves.not.toThrow();
    });

    test('emitStageRanking handles database errors gracefully', async () => {
      mockPrisma.competitions.update.mockRejectedValue(new Error('DB error'));

      // Should not throw
      await expect(displayManager.emitStageRanking(competitionId)).resolves.not.toThrow();
    });

    test('emitFinalRanking handles database errors gracefully', async () => {
      mockPrisma.competitions.update.mockRejectedValue(new Error('DB error'));

      // Should not throw
      await expect(displayManager.emitFinalRanking(competitionId)).resolves.not.toThrow();
    });
  });
});
