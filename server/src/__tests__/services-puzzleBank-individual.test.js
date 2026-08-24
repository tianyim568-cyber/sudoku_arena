// Unit tests for PuzzleBankService.generatePuzzles({ roundType: 'INDIVIDUAL_STANDARD' })
// (BUG-04 fix, Option C).
//
// Before this fix, the generator only knew ROUND1_NINE_ONE, ROUND2_RELAY,
// ROUND3_COLLABORATE — a solo round (INDIVIDUAL_STANDARD) fell through to
// the "default" branch that emitted one puzzle with a generic RX- id, no
// matter how much was asked for. Admins had no way to populate a solo round
// from the UI.
//
// This test pins the new case:
//   - N puzzles are actually produced (default 10 when count is omitted)
//   - Difficulty ratio is roughly 5/3/2 (EASY/MEDIUM/HARD) so a solo round
//     is not just "easy warm-ups"
//   - Every puzzle carries the organizationId (tenant isolation)
//   - Every puzzle has a valid 9x9 initialGrid and matching solution
//
// The bank file is redirected to a tmp path so the run does not pollute the
// real data/puzzle-bank.json (a live-test earlier this month polluted it,
// see JOURNAL_MODIFICATIONS.md 2026-08-24).

const fs = require('fs');
const path = require('path');
const os = require('os');
const PuzzleBankService = require('../services/PuzzleBankService');

describe('PuzzleBankService — INDIVIDUAL_STANDARD generator (BUG-04)', () => {
  let service;
  let tmpDir;
  let tmpBankPath;

  beforeEach(() => {
    // Fresh empty bank on disk so tests do not see each other's puzzles.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-puzzlebank-'));
    tmpBankPath = path.join(tmpDir, 'puzzle-bank.json');
    fs.writeFileSync(tmpBankPath, JSON.stringify({ meta: {}, puzzles: [] }));

    // The service loads the bank from a hard-coded path; we point its
    // private _bankPath at our tmp file after construction. The public API
    // does not expose it, but tests are allowed to reach in — same pattern
    // as logger.__pino.
    service = new PuzzleBankService({});
    service._bankPath = tmpBankPath;
    service._bank = null; // force reload from tmp file
  });

  afterEach(() => {
    // Clean up the temp directory so /tmp does not accumulate stale banks.
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) { /* ignore */ }
  });

  test('generates the requested count with the default 5/3/2 ratio', () => {
    const result = service.generatePuzzles({
      roundType: 'INDIVIDUAL_STANDARD',
      count: 10,
      organizationId: 'org-1',
    });

    expect(result.generated).toBe(10);
    expect(result.totalInBank).toBe(10);
    expect(result.newPuzzleIds).toHaveLength(10);

    // Re-read the bank to inspect the puzzles themselves.
    const bank = JSON.parse(fs.readFileSync(tmpBankPath, 'utf8'));
    expect(bank.puzzles).toHaveLength(10);

    const byDiff = bank.puzzles.reduce((acc, p) => {
      acc[p.difficulty] = (acc[p.difficulty] || 0) + 1;
      return acc;
    }, {});
    // 10 = 5 easy + 3 medium + 2 hard exactly.
    expect(byDiff).toEqual({ EASY: 5, MEDIUM: 3, HARD: 2 });
  });

  test('defaults to 10 puzzles when count is omitted', () => {
    const result = service.generatePuzzles({
      roundType: 'INDIVIDUAL_STANDARD',
      organizationId: 'org-1',
    });
    expect(result.generated).toBe(10);
  });

  test('tags every puzzle with the caller organizationId (tenant isolation)', () => {
    service.generatePuzzles({
      roundType: 'INDIVIDUAL_STANDARD',
      count: 5,
      organizationId: 'org-tenant-A',
    });
    const bank = JSON.parse(fs.readFileSync(tmpBankPath, 'utf8'));
    for (const p of bank.puzzles) {
      expect(p.organizationId).toBe('org-tenant-A');
      expect(p.roundType).toBe('INDIVIDUAL_STANDARD');
      expect(p.puzzleType).toBe('STANDARD');
    }
  });

  test('produces valid 9x9 grids with a matching solution', () => {
    service.generatePuzzles({
      roundType: 'INDIVIDUAL_STANDARD',
      count: 3,
      organizationId: 'org-1',
    });
    const bank = JSON.parse(fs.readFileSync(tmpBankPath, 'utf8'));

    for (const p of bank.puzzles) {
      // 9 rows, 9 columns.
      expect(p.initialGrid).toHaveLength(9);
      expect(p.solution).toHaveLength(9);
      for (let r = 0; r < 9; r++) {
        expect(p.initialGrid[r]).toHaveLength(9);
        expect(p.solution[r]).toHaveLength(9);
      }

      // Solution is a filled valid grid: every cell is in 1..9.
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const v = p.solution[r][c];
          expect(v).toBeGreaterThanOrEqual(1);
          expect(v).toBeLessThanOrEqual(9);
        }
      }

      // initialGrid uses 0 for blanks; every non-blank must match the solution.
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const given = p.initialGrid[r][c];
          if (given !== 0) {
            expect(given).toBe(p.solution[r][c]);
          }
        }
      }
    }
  });

  test('clamps count to at least 1', () => {
    const result = service.generatePuzzles({
      roundType: 'INDIVIDUAL_STANDARD',
      count: 0,
      organizationId: 'org-1',
    });
    // Zero falls through Math.max(1, ...) → 1 puzzle.
    expect(result.generated).toBeGreaterThanOrEqual(1);
  });
});
