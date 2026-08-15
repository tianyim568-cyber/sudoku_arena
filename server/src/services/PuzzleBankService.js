/**
 * PuzzleBankService — encapsulates puzzle bank CRUD operations.
 *
 * Extracted from puzzleBank.js route handlers following SRP.
 * Manages the puzzle-bank.json file and coordinates with PuzzleRepository.
 */

const fs = require('fs');
const path = require('path');

class PuzzleBankService {
  /**
   * @param {object} repos - repository factory
   */
  constructor(repos) {
    this.repos = repos;
    this._bankPath = path.join(__dirname, '..', '..', 'data', 'puzzle-bank.json');
    this._bank = null;
  }

  // ─── Lazy-load bank ────────────────────────────────────────────

  _load() {
    if (this._bank) return this._bank;
    if (fs.existsSync(this._bankPath)) {
      this._bank = JSON.parse(fs.readFileSync(this._bankPath, 'utf8'));
    } else {
      this._bank = { meta: {}, puzzles: [] };
    }
    return this._bank;
  }

  _save() {
    fs.writeFileSync(this._bankPath, JSON.stringify(this._bank, null, 2));
  }

  // ─── Read operations ───────────────────────────────────────────

  listPuzzles({ roundType, difficulty, puzzleType, limit, offset } = {}) {
    let puzzles = (this._load().puzzles || []).slice();

    if (roundType) puzzles = puzzles.filter(p => p.roundType === roundType);
    if (difficulty) puzzles = puzzles.filter(p => p.difficulty === difficulty);
    if (puzzleType) puzzles = puzzles.filter(p => p.puzzleType === puzzleType);

    // Don't expose solutions in listing
    const safe = puzzles.map(({ solution, ...rest }) => rest);

    const start = parseInt(offset) || 0;
    const end = start + (parseInt(limit) || safe.length);

    return { total: safe.length, puzzles: safe.slice(start, end), meta: this._bank.meta };
  }

  getPuzzleDetail(id) {
    const puzzle = this._load().puzzles.find(p => p.id === id);
    return puzzle || null;
  }

  getPuzzlePreview(id) {
    const puzzle = this.getPuzzleDetail(id);
    if (!puzzle) return null;
    return {
      id: puzzle.id,
      roundType: puzzle.roundType,
      difficulty: puzzle.difficulty,
      letter: puzzle.letter,
      points: puzzle.points,
      emptyCellCount: puzzle.initialGrid.flat().filter(v => v === 0).length,
      initialGrid: puzzle.initialGrid,
      solution: puzzle.solution,
    };
  }

  // ─── Generate puzzles ──────────────────────────────────────────

  generatePuzzles({ roundType, count = 1, teamsCount = 1 }) {
    const { SudokuGenerator } = require('../utils/sudokuGenerator');
    const gen = new SudokuGenerator();
    const bank = this._load();
    const newPuzzles = [];
    const nextOrder = (rt) => (bank.puzzles.filter(p => p.roundType === rt).length) + newPuzzles.filter(p => p.roundType === rt).length + 1;

    switch (roundType) {
      case 'ROUND1_NINE_ONE': {
        // Per team-set: 9 EASY JOC (1 empty cell each) + 1 MEDIUM FINAL = 10
        // `teamsCount` controls how many team-sets to generate (default 1)
        const sets = Math.max(1, teamsCount || 1);
        for (let s = 0; s < sets; s++) {
          // 9 EASY JOC
          for (let i = 0; i < 9; i++) {
            const sol = gen.generateSolution();
            newPuzzles.push({
              id: `R1-${bank.puzzles.length + newPuzzles.length + 1}`,
              roundType, puzzleType: 'JOC', difficulty: 'EASY',
              orderInRound: nextOrder(roundType),
              letter: null, points: 10,
              initialGrid: gen.generateRound1Puzzle(sol), solution: sol,
            });
          }
          // 1 MEDIUM FINAL
          {
            const sol = gen.generateSolution();
            newPuzzles.push({
              id: `R1-${bank.puzzles.length + newPuzzles.length + 1}`,
              roundType, puzzleType: 'FINAL', difficulty: 'MEDIUM',
              orderInRound: nextOrder(roundType),
              letter: null, points: 10,
              initialGrid: gen.createPuzzle(sol, { emptyCells: 30, symmetric: true }), solution: sol,
            });
          }
        }
        break;
      }

      case 'ROUND2_RELAY': {
        // Per team: 8 EASY + 6 MEDIUM + 2 HARD = 16
        const sets = Math.max(1, teamsCount || 1);
        for (let t = 0; t < sets; t++) {
          for (let i = 0; i < 8; i++) {
            const sol = gen.generateSolution();
            newPuzzles.push({
              id: `R2-${bank.puzzles.length + newPuzzles.length + 1}`,
              roundType, puzzleType: 'STANDARD', difficulty: 'EASY',
              orderInRound: newPuzzles.length + 1,
              letter: null, points: 8,
              initialGrid: gen.generateRound2EasyPuzzle(sol), solution: sol,
              teamIndex: t,
            });
          }
          for (let i = 0; i < 6; i++) {
            const sol = gen.generateSolution();
            newPuzzles.push({
              id: `R2-${bank.puzzles.length + newPuzzles.length + 1}`,
              roundType, puzzleType: 'STANDARD', difficulty: 'MEDIUM',
              orderInRound: newPuzzles.length + 1,
              letter: null, points: 16,
              initialGrid: gen.generateRound2Puzzle(sol), solution: sol,
              teamIndex: t,
            });
          }
          for (let i = 0; i < 2; i++) {
            const sol = gen.generateSolution();
            newPuzzles.push({
              id: `R2-${bank.puzzles.length + newPuzzles.length + 1}`,
              roundType, puzzleType: 'STANDARD', difficulty: 'HARD',
              orderInRound: newPuzzles.length + 1,
              letter: null, points: 20,
              initialGrid: gen.generateRound2HardPuzzle(sol), solution: sol,
              teamIndex: t,
            });
          }
        }
        break;
      }

      case 'ROUND3_COLLABORATE': {
        // 5 EASY + 3 MEDIUM + 2 HARD = 10 (shared across all teams)
        const dist = [
          { diff: 'EASY', gen: (s) => gen.generateRound3EasyPuzzle(s), pts: 10, count: 5 },
          { diff: 'MEDIUM', gen: (s) => gen.generateRound3MediumPuzzle(s), pts: 20, count: 3 },
          { diff: 'HARD', gen: (s) => gen.generateRound3HardPuzzle(s), pts: 45, count: 2 },
        ];
        for (const d of dist) {
          for (let j = 0; j < d.count; j++) {
            const sol = gen.generateSolution();
            newPuzzles.push({
              id: `R3-${bank.puzzles.length + newPuzzles.length + 1}`,
              roundType, puzzleType: 'STANDARD', difficulty: d.diff,
              orderInRound: newPuzzles.length + 1,
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
          id: `RX-${bank.puzzles.length + 1}`,
          roundType: roundType || 'UNKNOWN', puzzleType: 'STANDARD', difficulty: 'MEDIUM',
          orderInRound: 1,
          letter: null, points: 100,
          initialGrid: initial, solution,
        });
      }
    }

    bank.puzzles.push(...newPuzzles);
    this._save();

    return {
      generated: newPuzzles.length,
      totalInBank: bank.puzzles.length,
      newPuzzleIds: newPuzzles.map(p => p.id),
    };
  }

  // ─── Bulk generate for all rounds ───────────────────────────────

  /**
   * Generate puzzles for all three rounds given a team count.
   * R1: teamsCount × 10 (3E+3M+3H JOC + 1 FINAL each)
   * R2: teamsCount × 16 (8E+6M+2H each)
   * R3: 10 (5E+3M+2H, shared across all teams)
   *
   * @param {number} teamsCount - number of teams
   * @returns {{ r1: object, r2: object, r3: object, totalGenerated: number, totalInBank: number }}
   */
  generateBulk(teamsCount) {
    const r1 = this.generatePuzzles({ roundType: 'ROUND1_NINE_ONE', teamsCount });
    const r2 = this.generatePuzzles({ roundType: 'ROUND2_RELAY', teamsCount });
    const r3 = this.generatePuzzles({ roundType: 'ROUND3_COLLABORATE' });
    return {
      r1, r2, r3,
      totalGenerated: r1.generated + r2.generated + r3.generated,
      totalInBank: r3.totalInBank, // Last call has the final total
    };
  }

  // ─── Import to round ───────────────────────────────────────────

  async importToRound({ roundId, puzzleIds, count, teamsCount }) {
    const bank = this._load();
    const round = await this.repos.rounds.findById(roundId);
    if (!round) return { error: '轮次不存在', code: 40400 };

    const existingCount = await this.repos.puzzles.countByRound(roundId);
    if (existingCount > 0) {
      return { error: '该轮次已有题目，请先清除再导入', code: 40030, existing: existingCount };
    }

    let selectedPuzzles;
    let successCount = 0;

    if (puzzleIds && Array.isArray(puzzleIds)) {
      selectedPuzzles = bank.puzzles.filter(p => puzzleIds.includes(p.id));
    } else {
      const type = round.round_type;
      let pool = bank.puzzles.filter(p => p.roundType === type);

      if (type === 'ROUND1_NINE_ONE') {
        // R1: Import ALL available puzzles (not just 10).
        // Team-specific assignment happens at game start via PuzzleAssignmentService.
        // We need enough puzzles for all teams: teamsCount * (9 JOC + 1 FINAL)
        return await this._importR1Puzzles(roundId, round.competition_id, pool, teamsCount);
      } else if (type === 'ROUND2_RELAY') {
        return await this._importR2Puzzles(roundId, pool);
      } else if (type === 'ROUND3_COLLABORATE') {
        selectedPuzzles = this._selectR3Puzzles(pool);
      } else {
        // Shuffle and pick
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const n = count || 1;
        selectedPuzzles = pool.slice(0, n);
      }
    }

    if (!selectedPuzzles || selectedPuzzles.length === 0) {
      return { error: '题库中没有匹配的题目', code: 40020 };
    }

    for (let i = 0; i < selectedPuzzles.length; i++) {
      const p = selectedPuzzles[i];
      try {
        await this.repos.puzzles.create({
          roundId: parseInt(roundId),
          puzzleType: p.puzzleType,
          orderInRound: i + 1,
          initialGrid: JSON.stringify(p.initialGrid),
          solution: JSON.stringify(p.solution),
          points: p.points,
          letter: p.letter,
          difficulty: p.difficulty || null,
        });
        successCount++;
      } catch (e) {
        console.error('Import puzzle error:', e.message);
      }
    }

    return { imported: successCount, total: selectedPuzzles.length };
  }

  async _importR1Puzzles(roundId, competitionId, pool, teamsCount) {
    const teams = await this.repos.teams.findByCompetition(competitionId);
    const numTeams = teamsCount || teams.length || 1;

    // Validate: need at least numTeams * 9 JOC + numTeams * 1 FINAL
    const jocPool = pool.filter(p => p.puzzleType === 'JOC');
    const finalPool = pool.filter(p => p.puzzleType === 'FINAL');
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

    // Shuffle both pools for random order in DB
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

    // Import ALL JOC and FINAL puzzles into the round.
    // Letter assignment is NOT done at import time — it happens at game start
    // via PuzzleAssignmentService which assigns 9-letter words.
    let successCount = 0;
    let orderIdx = 1;

    for (const p of shuffledJoc) {
      try {
        await this.repos.puzzles.create({
          roundId: parseInt(roundId),
          puzzleType: p.puzzleType,
          orderInRound: orderIdx,
          initialGrid: JSON.stringify(p.initialGrid),
          solution: JSON.stringify(p.solution),
          points: p.points || 100,
          letter: null, // Letter will be assigned by PuzzleAssignmentService at game start
          difficulty: p.difficulty || null,
        });
        successCount++;
        orderIdx++;
      } catch (e) {
        console.error('Import R1 JOC puzzle error:', e.message);
      }
    }

    for (const p of shuffledFinal) {
      try {
        await this.repos.puzzles.create({
          roundId: parseInt(roundId),
          puzzleType: p.puzzleType,
          orderInRound: orderIdx,
          initialGrid: JSON.stringify(p.initialGrid),
          solution: JSON.stringify(p.solution),
          points: p.points || 100,
          letter: null,
          difficulty: p.difficulty || null,
        });
        successCount++;
        orderIdx++;
      } catch (e) {
        console.error('Import R1 FINAL puzzle error:', e.message);
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
    // Shuffle each difficulty pool for random selection
    const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);
    const selected = [];
    const easy = shuffle(pool.filter(p => p.difficulty === 'EASY')).slice(0, 5);
    const medium = shuffle(pool.filter(p => p.difficulty === 'MEDIUM')).slice(0, 3);
    const hard = shuffle(pool.filter(p => p.difficulty === 'HARD')).slice(0, 2);
    selected.push(...easy, ...medium, ...hard);
    return selected;
  }

  async _importR2Puzzles(roundId, pool) {
    // Round 2 uses ONE shared set of 16 puzzles (8 EASY + 6 MEDIUM + 2 HARD)
    // for ALL teams — every team is tested on the same questions. Puzzles are
    // stored with team_id = null (shared); the engine already reads shared
    // puzzles (`|| !p.team_id`, `team_id IS NULL`) and tracks progress per team.
    // No teams need to exist before importing.
    const r2Pool = [...pool].filter(p => p.roundType === 'ROUND2_RELAY').sort(() => Math.random() - 0.5);

    let easyPuzzles = r2Pool.filter(p => p.difficulty === 'EASY').slice(0, 8);
    let medPuzzles = r2Pool.filter(p => p.difficulty === 'MEDIUM').slice(0, 6);
    let hardPuzzles = r2Pool.filter(p => p.difficulty === 'HARD').slice(0, 2);

    const { SudokuGenerator } = require('../utils/sudokuGenerator');
    const gen = new SudokuGenerator();

    while (easyPuzzles.length < 8) {
      const sol = gen.generateSolution();
      easyPuzzles.push({ puzzleType: 'STANDARD', difficulty: 'EASY', points: 8,
        initialGrid: gen.generateRound2EasyPuzzle(sol), solution: sol });
    }
    while (medPuzzles.length < 6) {
      const sol = gen.generateSolution();
      medPuzzles.push({ puzzleType: 'STANDARD', difficulty: 'MEDIUM', points: 16,
        initialGrid: gen.generateRound2Puzzle(sol), solution: sol });
    }
    while (hardPuzzles.length < 2) {
      const sol = gen.generateSolution();
      hardPuzzles.push({ puzzleType: 'STANDARD', difficulty: 'HARD', points: 20,
        initialGrid: gen.generateRound2HardPuzzle(sol), solution: sol });
    }

    const ordered = [...easyPuzzles, ...medPuzzles, ...hardPuzzles];

    let successCount = 0;
    for (let i = 0; i < ordered.length; i++) {
      const p = ordered[i];
      try {
        await this.repos.puzzles.create({
          roundId: parseInt(roundId),
          puzzleType: p.puzzleType,
          orderInRound: i + 1,
          initialGrid: JSON.stringify(p.initialGrid),
          solution: JSON.stringify(p.solution),
          points: p.points || 100,
          letter: p.letter || null,
          difficulty: p.difficulty,
          teamId: null, // shared across all teams
        });
        successCount++;
      } catch (e) {
        console.error('Import puzzle error:', e.message);
      }
    }

    return { imported: successCount, shared: true, total: ordered.length };
  }

  // ─── Delete operations ─────────────────────────────────────────

  async deletePuzzle(id) {
    const bank = this._load();
    const index = bank.puzzles.findIndex(p => p.id === id);
    if (index === -1) return { deleted: false, message: '题目不存在' };

    bank.puzzles.splice(index, 1);
    this._save();

    // Also delete from DB if it was imported
    const dbPuzzle = await this.repos.puzzles.findById(parseInt(id.replace(/^[A-Z]+-/, '')));
    if (dbPuzzle) {
      await this.repos.puzzles.deleteById(dbPuzzle.id);
    }

    return { deleted: true, id };
  }

  async clearAll() {
    const bank = this._load();
    const count = bank.puzzles.length;
    bank.puzzles = [];
    this._save();

    // Also clear from DB
    await this.repos.puzzles.clearAll();

    return { deleted: count };
  }
}

module.exports = PuzzleBankService;
