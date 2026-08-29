/**
 * PuzzleBankService — encapsulates puzzle bank CRUD operations.
 *
 * ISSUE-25 (2026-08-25): the flat JSON file (puzzle-bank.json) is gone.
 * The bank now lives in the `puzzles` table, scoped by organization_id.
 * This kills three bugs at once:
 *   1. ID collisions after deletion (UUIDs replace R1-N array-length IDs)
 *   2. Unbounded growth (a DB table is naturally bounded by org)
 *   3. Concurrent-write races (Prisma is the single writer)
 *
 * The public API stays compatible with the route handlers:
 *   listPuzzles, getPuzzleDetail, getPuzzlePreview,
 *   generatePuzzles, generateBulk, importToRound,
 *   deletePuzzle, clearAll.
 *
 * The methods now async because they hit the DB instead of an
 * in-memory object. Callers that used to be sync (listPuzzles,
 * generatePuzzles, getPuzzleDetail) are now async.
 */

const logger = require('../utils/logger');

class PuzzleBankService {
  /**
   * @param {object} repos - repository factory
   */
  constructor(repos) {
    this.repos = repos;
  }

  // ─── Read operations ───────────────────────────────────────────

  async listPuzzles({ roundType, difficulty, puzzleType, limit, offset, organizationId } = {}) {
    const result = await this.repos.puzzles.findByOrganization({
      organizationId, roundType, difficulty, puzzleType, limit, offset,
    });

    // Don't expose solution in listing — keeps the payload small and
    // matches the old behavior where solution was stripped.
    const safe = result.puzzles.map(p => this._stripSolution(p));

    return { total: result.total, puzzles: safe, meta: {} };
  }

  /**
   * Find puzzles by round type — dedicated endpoint for the UI picker.
   *
   * Returns puzzle data including solution_grid so the admin can preview
   * puzzles with the interactive modal before importing them. Includes
   * emptyCellCount for at-a-glance difficulty comparison.
   */
  async findByType({ roundType, difficulty, limit, offset, organizationId }) {
    const result = await this.repos.puzzles.findByOrganization({
      organizationId, roundType, difficulty, limit, offset,
    });

    const puzzles = result.puzzles.map(p => {
      const grid = p.initial_grid;
      return {
        id: p.id,
        difficulty: p.difficulty,
        score: p.score,
        type: p.type,
        initialGrid: grid,
        solution: p.solution_grid,
        emptyCellCount: Array.isArray(grid)
          ? grid.flat().filter(v => v === 0).length
          : 0,
      };
    });

    return { total: result.total, puzzles };
  }

  async getPuzzleDetail(id, organizationId) {
    const puzzle = await this.repos.puzzles.findByIdAndOrg(id, organizationId);
    if (!puzzle) return null;
    // Reshape to the legacy field names the route expects.
    return this._legacyShape(puzzle);
  }

  async getPuzzlePreview(id, organizationId) {
    const puzzle = await this.getPuzzleDetail(id, organizationId);
    if (!puzzle) return null;
    return {
      id: puzzle.id,
      roundType: puzzle.roundType,
      difficulty: puzzle.difficulty,
      letter: puzzle.letter,
      points: puzzle.points,
      emptyCellCount: Array.isArray(puzzle.initialGrid) ? puzzle.initialGrid.flat().filter(v => v === 0).length : 0,
      initialGrid: puzzle.initialGrid,
      solution: puzzle.solution,
    };
  }

  // ─── Generate puzzles ──────────────────────────────────────────

  async generatePuzzles({ roundType, count, teamsCount = 1, organizationId }) {
    const { SudokuGenerator } = require('../utils/sudokuGenerator');
    const gen = new SudokuGenerator();
    const newPuzzles = [];

    switch (roundType) {
      case 'ROUND1_NINE_ONE': {
        const sets = Math.max(1, teamsCount || 1);
        for (let s = 0; s < sets; s++) {
          for (let i = 0; i < 9; i++) {
            const sol = gen.generateSolution();
            newPuzzles.push({
              organizationId, roundType,
              puzzleType: 'JOC', difficulty: 'EASY',
              letter: null, points: 10,
              initialGrid: gen.generateRound1Puzzle(sol), solution: sol,
            });
          }
          {
            const sol = gen.generateSolution();
            newPuzzles.push({
              organizationId, roundType,
              puzzleType: 'FINAL', difficulty: 'MEDIUM',
              letter: null, points: 10,
              initialGrid: gen.createPuzzle(sol, { emptyCells: 30, symmetric: true }), solution: sol,
            });
          }
        }
        break;
      }

      case 'ROUND2_RELAY': {
        const sets = Math.max(1, teamsCount || 1);
        for (let t = 0; t < sets; t++) {
          for (let i = 0; i < 8; i++) {
            const sol = gen.generateSolution();
            newPuzzles.push({
              organizationId, roundType,
              puzzleType: 'STANDARD', difficulty: 'EASY',
              letter: null, points: 8,
              initialGrid: gen.generateRound2EasyPuzzle(sol), solution: sol,
            });
          }
          for (let i = 0; i < 6; i++) {
            const sol = gen.generateSolution();
            newPuzzles.push({
              organizationId, roundType,
              puzzleType: 'STANDARD', difficulty: 'MEDIUM',
              letter: null, points: 16,
              initialGrid: gen.generateRound2Puzzle(sol), solution: sol,
            });
          }
          for (let i = 0; i < 2; i++) {
            const sol = gen.generateSolution();
            newPuzzles.push({
              organizationId, roundType,
              puzzleType: 'STANDARD', difficulty: 'HARD',
              letter: null, points: 20,
              initialGrid: gen.generateRound2HardPuzzle(sol), solution: sol,
            });
          }
        }
        break;
      }

      case 'INDIVIDUAL_STANDARD': {
        const n = Math.max(1, count || 10);
        const nEasy = Math.round(n * 0.5);
        const nMed = Math.round(n * 0.3);
        const nHard = Math.max(0, n - nEasy - nMed);
        const dist = [
          { diff: 'EASY', emptyCells: 35, pts: 10, count: nEasy },
          { diff: 'MEDIUM', emptyCells: 45, pts: 20, count: nMed },
          { diff: 'HARD', emptyCells: 55, pts: 35, count: nHard },
        ];
        for (const d of dist) {
          for (let j = 0; j < d.count; j++) {
            const sol = gen.generateSolution();
            newPuzzles.push({
              organizationId, roundType,
              puzzleType: 'STANDARD', difficulty: d.diff,
              letter: null, points: d.pts,
              initialGrid: gen.createPuzzle(sol, { emptyCells: d.emptyCells, symmetric: true }),
              solution: sol,
            });
          }
        }
        break;
      }

      case 'ROUND3_COLLABORATE': {
        const dist = [
          { diff: 'EASY', gen: (s) => gen.generateRound3EasyPuzzle(s), pts: 10, count: 5 },
          { diff: 'MEDIUM', gen: (s) => gen.generateRound3MediumPuzzle(s), pts: 20, count: 3 },
          { diff: 'HARD', gen: (s) => gen.generateRound3HardPuzzle(s), pts: 45, count: 2 },
        ];
        for (const d of dist) {
          for (let j = 0; j < d.count; j++) {
            const sol = gen.generateSolution();
            newPuzzles.push({
              organizationId, roundType,
              puzzleType: 'STANDARD', difficulty: d.diff,
              letter: null, points: d.pts,
              initialGrid: d.gen(sol), solution: sol,
            });
          }
        }
        break;
      }

      default: {
        const solution = gen.generateSolution();
        const initial = gen.createPuzzle(solution, { emptyCells: 35 });
        newPuzzles.push({
          organizationId,
          roundType: roundType || 'UNKNOWN',
          puzzleType: 'STANDARD', difficulty: 'MEDIUM',
          letter: null, points: 100,
          initialGrid: initial, solution,
        });
      }
    }

    // Write each puzzle to the DB. We don't use a transaction because
    // each row is independent and partial failures should not roll
    // back the successful ones — better to import 8 of 10 than 0.
    const created = [];
    let skipped = 0;
    for (const p of newPuzzles) {
      try {
        const row = await this.repos.puzzles.createStandalone(p);
        if (row.isDuplicate) {
          skipped++;
        }
        // Include duplicates in created[] so they can still be attached
        // to a round — dedup prevents re-inserting into the DB, but the
        // puzzle is reusable across rounds.
        created.push(row);
      } catch (e) {
        logger.error('PuzzleBankService.generatePuzzles: createStandalone failed', {
          organizationId, roundType, error: e.message,
        });
      }
    }

    // totalInBank now comes from the DB count for this org, not from
    // an in-memory array length. This is slower but accurate.
    const totalInBank = await this.repos.puzzles.countByOrganization(organizationId);

    return {
      generated: created.length - skipped,
      skipped,
      totalInBank,
      newPuzzleIds: created.map(p => p.id),
    };
  }

  // ─── Bulk generate for all rounds ───────────────────────────────

  /**
   * Generate puzzles for all three rounds given a team count.
   * R1: teamsCount × 10 (9 JOC + 1 FINAL each)
   * R2: teamsCount × 16 (8E+6M+2H each)
   * R3: 10 (5E+3M+2H, shared across all teams)
   */
  async generateBulk(teamsCount, organizationId) {
    const r1 = await this.generatePuzzles({ roundType: 'ROUND1_NINE_ONE', teamsCount, organizationId });
    const r2 = await this.generatePuzzles({ roundType: 'ROUND2_RELAY', teamsCount, organizationId });
    const r3 = await this.generatePuzzles({ roundType: 'ROUND3_COLLABORATE', organizationId });
    return {
      r1, r2, r3,
      totalGenerated: r1.generated + r2.generated + r3.generated,
      totalInBank: r3.totalInBank,
    };
  }

  // ─── Import to round ───────────────────────────────────────────

  async importToRound({ roundId, puzzleIds, count, teamsCount }) {
    const round = await this.repos.rounds.findById(roundId);
    if (!round) return { error: '轮次不存在', code: 40400 };

    const existingCount = await this.repos.puzzles.countByRound(roundId);
    if (existingCount > 0) {
      return { error: '该轮次已有题目，请先清除再导入', code: 40030, existing: existingCount };
    }

    let selectedPuzzles;
    let successCount = 0;

    if (puzzleIds && Array.isArray(puzzleIds)) {
      // Pull the requested puzzles directly from the DB by their UUIDs.
      selectedPuzzles = await this.repos.puzzles.findByIds(puzzleIds);
    } else {
      const type = round.round_type;
      // The pool is now the puzzles in this org with matching round_type.
      const pool = await this.repos.puzzles.findByOrganization({
        organizationId: round.organization_id || undefined,
        roundType: type,
      });
      const puzzles = pool.puzzles;

      if (type === 'ROUND1_NINE_ONE') {
        return await this._importR1Puzzles(roundId, round.competition_id, puzzles, teamsCount);
      } else if (type === 'ROUND2_RELAY') {
        return await this._importR2Puzzles(roundId, puzzles);
      } else if (type === 'ROUND3_COLLABORATE') {
        selectedPuzzles = this._selectR3Puzzles(puzzles);
      } else {
        // Shuffle and pick
        const shuffled = [...puzzles];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const n = count || 1;
        selectedPuzzles = shuffled.slice(0, n);
      }
    }

    if (!selectedPuzzles || selectedPuzzles.length === 0) {
      return { error: '题库中没有匹配的题目', code: 40020 };
    }

    for (let i = 0; i < selectedPuzzles.length; i++) {
      const p = selectedPuzzles[i];
      try {
        await this.repos.puzzles.attachToRound({
          roundId,
          puzzleId: p.id,
          orderInRound: i + 1,
          points: p.points || p.score || 100,
        });
        successCount++;
      } catch (e) {
        logger.error('Import puzzle failed', { roundId, puzzleId: p.id, error: e.message });
      }
    }

    return { imported: successCount, total: selectedPuzzles.length };
  }

  async _importR1Puzzles(roundId, competitionId, pool, teamsCount) {
    const teams = await this.repos.teams.findByCompetition(competitionId);
    const numTeams = teamsCount || teams.length || 1;

    const jocPool = pool.filter(p => (p.type || p.puzzleType) === 'JOC');
    const finalPool = pool.filter(p => (p.type || p.puzzleType) === 'FINAL');
    const requiredJoc = numTeams * 9;
    const requiredFinal = numTeams;

    if (jocPool.length < requiredJoc) {
      return {
        error: `JOC题目不足：需要 ${requiredJoc} 个（${numTeams} 队 × 9），题库仅有 ${jocPool.length} 个。请先生成更多题目。`,
        code: 40020,
        required: { joc: requiredJoc, final: requiredFinal },
        available: { joc: jocPool.length, final: finalPool.length }
      };
    }
    if (finalPool.length < requiredFinal) {
      return {
        error: `FINAL题目不足：需要 ${requiredFinal} 个（${numTeams} 队 × 1），题库仅有 ${finalPool.length} 个。请先生成更多题目。`,
        code: 40020,
        required: { joc: requiredJoc, final: requiredFinal },
        available: { joc: jocPool.length, final: finalPool.length }
      };
    }

    const shuffle = (arr) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    const shuffledJoc = shuffle(jocPool);
    const shuffledFinal = shuffle(finalPool);

    let successCount = 0;
    let orderIdx = 1;

    for (const p of shuffledJoc) {
      try {
        await this.repos.puzzles.attachToRound({
          roundId,
          puzzleId: p.id,
          orderInRound: orderIdx,
          points: p.score || p.points || 100,
        });
        successCount++;
        orderIdx++;
      } catch (e) {
        logger.error('Import R1 JOC puzzle failed', { roundId, puzzleId: p.id, error: e.message });
      }
    }

    for (const p of shuffledFinal) {
      try {
        await this.repos.puzzles.attachToRound({
          roundId,
          puzzleId: p.id,
          orderInRound: orderIdx,
          points: p.score || p.points || 100,
        });
        successCount++;
        orderIdx++;
      } catch (e) {
        logger.error('Import R1 FINAL puzzle failed', { roundId, puzzleId: p.id, error: e.message });
      }
    }

    return {
      imported: successCount,
      jocImported: shuffledJoc.length,
      finalImported: shuffledFinal.length,
      teams: numTeams,
      requiredJoc,
      requiredFinal
    };
  }

  _selectR3Puzzles(pool) {
    const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);
    const selected = [];
    const easy = shuffle(pool.filter(p => p.difficulty === 'EASY')).slice(0, 5);
    const medium = shuffle(pool.filter(p => p.difficulty === 'MEDIUM')).slice(0, 3);
    const hard = shuffle(pool.filter(p => p.difficulty === 'HARD')).slice(0, 2);
    selected.push(...easy, ...medium, ...hard);
    return selected;
  }

  async _importR2Puzzles(roundId, pool) {
    const r2Pool = [...pool].sort(() => Math.random() - 0.5);

    let easyPuzzles = r2Pool.filter(p => p.difficulty === 'EASY').slice(0, 8);
    let medPuzzles = r2Pool.filter(p => p.difficulty === 'MEDIUM').slice(0, 6);
    let hardPuzzles = r2Pool.filter(p => p.difficulty === 'HARD').slice(0, 2);

    // If the bank doesn't have enough puzzles of a given difficulty,
    // generate fresh ones and write them to the library + attach to
    // the round in one go. This is the same fallback as before, but
    // it now goes through the DB instead of the JSON file.
    const { SudokuGenerator } = require('../utils/sudokuGenerator');
    const gen = new SudokuGenerator();

    while (easyPuzzles.length < 8) {
      const sol = gen.generateSolution();
      const created = await this.repos.puzzles.createStandalone({
        puzzleType: 'STANDARD', difficulty: 'EASY', points: 8,
        initialGrid: gen.generateRound2EasyPuzzle(sol), solution: sol,
        roundType: 'ROUND2_RELAY',
      });
      easyPuzzles.push(created);
    }
    while (medPuzzles.length < 6) {
      const sol = gen.generateSolution();
      const created = await this.repos.puzzles.createStandalone({
        puzzleType: 'STANDARD', difficulty: 'MEDIUM', points: 16,
        initialGrid: gen.generateRound2Puzzle(sol), solution: sol,
        roundType: 'ROUND2_RELAY',
      });
      medPuzzles.push(created);
    }
    while (hardPuzzles.length < 2) {
      const sol = gen.generateSolution();
      const created = await this.repos.puzzles.createStandalone({
        puzzleType: 'STANDARD', difficulty: 'HARD', points: 20,
        initialGrid: gen.generateRound2HardPuzzle(sol), solution: sol,
        roundType: 'ROUND2_RELAY',
      });
      hardPuzzles.push(created);
    }

    const ordered = [...easyPuzzles, ...medPuzzles, ...hardPuzzles];

    let successCount = 0;
    for (let i = 0; i < ordered.length; i++) {
      const p = ordered[i];
      try {
        await this.repos.puzzles.attachToRound({
          roundId,
          puzzleId: p.id,
          orderInRound: i + 1,
          points: p.score || p.points || 100,
        });
        successCount++;
      } catch (e) {
        logger.error('Import R2 puzzle failed', { roundId, puzzleId: p.id, error: e.message });
      }
    }

    return { imported: successCount, shared: true, total: ordered.length };
  }

  // ─── Delete operations ─────────────────────────────────────────

  async deletePuzzle(id, organizationId) {
    const row = await this.repos.puzzles.deleteByIdAndOrg(id, organizationId);
    if (!row) return { deleted: false, message: '题目不存在或无权删除' };
    return { deleted: true, id };
  }

  async clearAll(organizationId) {
    const count = await this.repos.puzzles.clearByOrganization(organizationId);
    return { deleted: count };
  }

  // ─── Shaping helpers ───────────────────────────────────────────

  /**
   * Strip the solution from a puzzle row for the listing endpoint.
   * Keeps the payload small and matches the old JSON behavior.
   */
  _stripSolution(p) {
    const { solution_grid, ...rest } = p;
    return rest;
  }

  /**
   * Reshape a DB puzzle row to the legacy field names the route
   * handlers and the client expect. The new schema uses snake_case;
   * the old JSON used camelCase.
   */
  _legacyShape(p) {
    return {
      id: p.id,
      organizationId: p.organization_id,
      roundType: p.round_type,
      puzzleType: p.type,
      difficulty: p.difficulty,
      points: p.score,
      letter: null, // column removed in new schema
      initialGrid: p.initial_grid,
      solution: p.solution_grid,
      categoryId: p.category_id,
      createdAt: p.created_at,
    };
  }
}

module.exports = PuzzleBankService;
