// Unit tests for PuzzleBankService.generatePuzzles({ roundType: 'INDIVIDUAL_STANDARD' })
// (BUG-04 fix, Option C).
//
// ISSUE-25 (2026-08-25): the puzzle bank moved from puzzle-bank.json to
// the `puzzles` table. These tests no longer write to a tmp JSON file;
// they mock the repository so the service talks to an in-memory store.
// The assertions that matter are preserved:
//   - N puzzles are actually produced (default 10 when count is omitted)
//   - Difficulty ratio is roughly 5/3/2 (EASY/MEDIUM/HARD)
//   - Every puzzle carries the organizationId (tenant isolation)
//   - Every puzzle has a valid 9x9 initialGrid and matching solution
//
// The mock records every call so tests can assert on the arguments.

const PuzzleBankService = require('../services/PuzzleBankService');

// Build an in-memory mock of the puzzles repository. Each call to
// createStandalone returns a row with a fresh UUID-like id and stores
// the puzzle in `store` so later assertions can inspect it.
function buildMockPuzzlesRepo() {
  const store = [];
  let counter = 0;
  return {
    store,
    createStandalone: jest.fn(async (p) => {
      counter += 1;
      const row = {
        id: `uuid-mock-${counter}`,
        type: p.puzzleType,
        initial_grid: p.initialGrid,
        solution_grid: p.solution,
        difficulty: p.difficulty,
        score: p.points,
        organization_id: p.organizationId,
        round_type: p.roundType,
        category_id: p.categoryId || null,
        created_at: new Date().toISOString(),
      };
      store.push(row);
      return row;
    }),
    countByOrganization: jest.fn(async () => store.length),
    attachToRound: jest.fn(async () => ({})),
    findByIdAndOrg: jest.fn(async () => null),
    deleteByIdAndOrg: jest.fn(async () => null),
    clearByOrganization: jest.fn(async () => 0),
    findByOrganization: jest.fn(async () => ({ total: store.length, puzzles: store })),
  };
}

describe('PuzzleBankService — INDIVIDUAL_STANDARD generator (BUG-04, ISSUE-25)', () => {
  let service;
  let puzzlesRepo;

  beforeEach(() => {
    puzzlesRepo = buildMockPuzzlesRepo();
    service = new PuzzleBankService({ puzzles: puzzlesRepo });
  });

  test('generates the requested count with the default 5/3/2 ratio', async () => {
    const result = await service.generatePuzzles({
      roundType: 'INDIVIDUAL_STANDARD',
      count: 10,
      organizationId: 'org-1',
    });

    expect(result.generated).toBe(10);
    expect(result.totalInBank).toBe(10);
    expect(result.newPuzzleIds).toHaveLength(10);

    // Inspect the stored puzzles.
    expect(puzzlesRepo.store).toHaveLength(10);

    const byDiff = puzzlesRepo.store.reduce((acc, p) => {
      acc[p.difficulty] = (acc[p.difficulty] || 0) + 1;
      return acc;
    }, {});
    // 10 = 5 easy + 3 medium + 2 hard exactly.
    expect(byDiff).toEqual({ EASY: 5, MEDIUM: 3, HARD: 2 });
  });

  test('defaults to 10 puzzles when count is omitted', async () => {
    const result = await service.generatePuzzles({
      roundType: 'INDIVIDUAL_STANDARD',
      organizationId: 'org-1',
    });
    expect(result.generated).toBe(10);
  });

  test('tags every puzzle with the caller organizationId (tenant isolation)', async () => {
    await service.generatePuzzles({
      roundType: 'INDIVIDUAL_STANDARD',
      count: 5,
      organizationId: 'org-tenant-A',
    });

    for (const p of puzzlesRepo.store) {
      expect(p.organization_id).toBe('org-tenant-A');
      expect(p.round_type).toBe('INDIVIDUAL_STANDARD');
      expect(p.type).toBe('STANDARD');
    }
  });

  test('produces valid 9x9 grids with a matching solution', async () => {
    await service.generatePuzzles({
      roundType: 'INDIVIDUAL_STANDARD',
      count: 3,
      organizationId: 'org-1',
    });

    for (const p of puzzlesRepo.store) {
      // 9 rows, 9 columns.
      expect(p.initial_grid).toHaveLength(9);
      expect(p.solution_grid).toHaveLength(9);
      for (let r = 0; r < 9; r++) {
        expect(p.initial_grid[r]).toHaveLength(9);
        expect(p.solution_grid[r]).toHaveLength(9);
      }

      // Solution is a filled valid grid: every cell is in 1..9.
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const v = p.solution_grid[r][c];
          expect(v).toBeGreaterThanOrEqual(1);
          expect(v).toBeLessThanOrEqual(9);
        }
      }

      // initialGrid uses 0 for blanks; every non-blank must match the solution.
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const given = p.initial_grid[r][c];
          if (given !== 0) {
            expect(given).toBe(p.solution_grid[r][c]);
          }
        }
      }
    }
  });

  test('clamps count to at least 1', async () => {
    const result = await service.generatePuzzles({
      roundType: 'INDIVIDUAL_STANDARD',
      count: 0,
      organizationId: 'org-1',
    });
    // Zero falls through Math.max(1, ...) → 1 puzzle.
    expect(result.generated).toBeGreaterThanOrEqual(1);
  });
});
