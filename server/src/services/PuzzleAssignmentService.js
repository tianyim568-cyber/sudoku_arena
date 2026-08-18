/**
 * PuzzleAssignmentService — per-team puzzle assignment with randomized,
 * difficulty-balanced sets and 9-letter word system.
 *
 * Responsibilities:
 * - Assign non-overlapping puzzle sets to each team (9 JOC + 1 FINAL)
 * - Balance difficulty across teams (stratified sampling)
 * - Assign 9-letter words where each letter maps to a JOC puzzle
 * - Handle repeated letters (different puzzles for same letter position)
 * - Persist assignments to team_puzzle_sets table
 * - Support idempotent restart (don't reassign on restart)
 *
 * All methods are async (PostgreSQL).
 */

const WORDS = require('../data/words');
const logger = require('../utils/logger');

class PuzzleAssignmentService {
  /**
   * @param {object} repos - repository factory
   */
  constructor(repos) {
    this.repos = repos;
  }

  // ─── Per-team puzzle assignment ────────────────────────────────

  /**
   * Assign non-overlapping, difficulty-balanced puzzle sets to each team.
   * Each team gets 9 JOC puzzles + 1 FINAL puzzle.
   *
   * @param {number} competitionId
   * @param {number} roundId
   * @param {Array} teams - team objects with id property
   * @param {Array} allPuzzles - full puzzle pool for the round
   * @returns {Map<number, Array>} teamPuzzleMap: teamId -> puzzle array (9 JOC + 1 FINAL)
   */
  async assignPerTeamPuzzles(competitionId, roundId, teams, allPuzzles) {
    const teamPuzzleMap = new Map();

    // 0. Check for existing assignments (idempotent restart)
    const existingAssignments = await this._loadExistingAssignments(roundId, teams, allPuzzles);
    if (existingAssignments) {
      return existingAssignments;
    }

    // 1. Separate JOC and FINAL pools
    const jocPool = allPuzzles.filter(p =>
      (p.puzzle_type === 'JOC' || p.puzzleType === 'JOC')
    );
    const finalPool = allPuzzles.filter(p =>
      (p.puzzle_type === 'FINAL' || p.puzzleType === 'FINAL')
    );

    // 2. Stratify JOC pool by difficulty
    const jocByDifficulty = this._stratifyByDifficulty(jocPool);

    // 3. Shuffle each difficulty tier (Fisher-Yates)
    for (const diff of Object.keys(jocByDifficulty)) {
      this._shuffle(jocByDifficulty[diff]);
    }

    // 4. Shuffle FINAL pool
    const shuffledFinals = [...finalPool];
    this._shuffle(shuffledFinals);

    // Track which puzzles have been assigned
    const assignedIds = new Set();

    // 5. Compute difficulty distribution for balanced assignment
    const difficultyRatios = this._computeDifficultyRatios(jocByDifficulty, 9);

    // 6. Pick a unique word for each team
    const nineLetterWords = WORDS.filter(w => w.length === 9);
    const teamWords = this._pickWordsForTeams(teams.length, nineLetterWords);

    // 7. Assign puzzles to each team
    for (let ti = 0; ti < teams.length; ti++) {
      const team = teams[ti];
      const word = teamWords[ti];
      const teamPuzzles = [];

      // Pick 9 JOC puzzles with balanced difficulty
      const jocPicks = this._pickBalancedJocPuzzles(
        jocByDifficulty, difficultyRatios, assignedIds, 9
      );
      teamPuzzles.push(...jocPicks);
      for (const p of jocPicks) {
        assignedIds.add(p.id);
      }

      // Pick 1 FINAL puzzle
      const finalPick = this._pickFinalPuzzle(shuffledFinals, assignedIds);
      if (finalPick) {
        teamPuzzles.push(finalPick);
        assignedIds.add(finalPick.id);
      }

      // Assign word letters to JOC puzzles (9 letters → 9 JOC puzzles)
      await this._assignWordLetters(teamPuzzles, word);

      teamPuzzleMap.set(team.id, teamPuzzles);

      // Persist assignment
      await this._persistAssignment(competitionId, roundId, team.id, word, teamPuzzles);
    }

    return teamPuzzleMap;
  }

  // ─── Difficulty stratification ────────────────────────────────

  _stratifyByDifficulty(puzzles) {
    const tiers = { EASY: [], MEDIUM: [], HARD: [], UNKNOWN: [] };
    for (const p of puzzles) {
      const diff = p.difficulty || p.difficulty_level || 'UNKNOWN';
      if (tiers[diff]) {
        tiers[diff].push(p);
      } else {
        tiers.UNKNOWN.push(p);
      }
    }
    if (tiers.UNKNOWN.length > 0) {
      tiers.MEDIUM.push(...tiers.UNKNOWN);
      tiers.UNKNOWN = [];
    }
    return tiers;
  }

  _computeDifficultyRatios(jocByDifficulty, total) {
    const easyCount = jocByDifficulty.EASY.length;
    const medCount = jocByDifficulty.MEDIUM.length;
    const hardCount = jocByDifficulty.HARD.length;
    const totalAvailable = easyCount + medCount + hardCount;

    if (totalAvailable === 0) {
      return { EASY: 0, MEDIUM: total, HARD: 0 };
    }

    const ratios = {
      EASY: Math.round((easyCount / totalAvailable) * total),
      MEDIUM: Math.round((medCount / totalAvailable) * total),
      HARD: Math.round((hardCount / totalAvailable) * total),
    };

    let sum = ratios.EASY + ratios.MEDIUM + ratios.HARD;
    while (sum < total) {
      if (easyCount >= medCount && easyCount >= hardCount) ratios.EASY++;
      else if (medCount >= hardCount) ratios.MEDIUM++;
      else ratios.HARD++;
      sum++;
    }
    while (sum > total) {
      if (ratios.HARD > 0) ratios.HARD--;
      else if (ratios.MEDIUM > 0) ratios.MEDIUM--;
      else ratios.EASY--;
      sum--;
    }

    return ratios;
  }

  _pickBalancedJocPuzzles(jocByDifficulty, ratios, assignedIds, total) {
    const selected = [];

    for (const [diff, count] of Object.entries(ratios)) {
      const pool = jocByDifficulty[diff] || [];
      let picked = 0;
      while (picked < count && pool.length > 0) {
        const puzzle = pool.shift();
        if (!assignedIds.has(puzzle.id)) {
          selected.push(puzzle);
          picked++;
        }
      }
    }

    if (selected.length < total) {
      const allRemaining = [
        ...(jocByDifficulty.EASY || []),
        ...(jocByDifficulty.MEDIUM || []),
        ...(jocByDifficulty.HARD || []),
      ].filter(p => !assignedIds.has(p.id) && !selected.includes(p));

      this._shuffle(allRemaining);
      for (const p of allRemaining) {
        if (selected.length >= total) break;
        selected.push(p);
      }
    }

    return selected;
  }

  // ─── FINAL puzzle selection ────────────────────────────────────

  _pickFinalPuzzle(shuffledFinals, assignedIds) {
    for (const p of shuffledFinals) {
      if (!assignedIds.has(p.id)) {
        return p;
      }
    }
    return null;
  }

  // ─── Word-letter assignment ────────────────────────────────────

  async _assignWordLetters(puzzles, word) {
    if (!word || word.length < 9) return;

    const jocPuzzles = puzzles.filter(p =>
      p.puzzle_type === 'JOC' || p.puzzleType === 'JOC'
    );

    for (let i = 0; i < 9 && i < jocPuzzles.length; i++) {
      const letter = word[i].toUpperCase();
      jocPuzzles[i].letter = letter;

      // Persist letter to DB
      if (jocPuzzles[i].id && this.repos?.puzzles) {
        try {
          if (typeof jocPuzzles[i].id === 'number') {
            await this.repos.puzzles.updateLetter(jocPuzzles[i].id, letter);
          }
        } catch (e) {
          // Non-critical: letter assignment in memory is sufficient
        }
      }
    }
  }

  // ─── Word selection ────────────────────────────────────────────

  _pickWordsForTeams(teamCount, wordList) {
    if (wordList.length === 0) {
      const fallback = [];
      for (let i = 0; i < teamCount; i++) {
        fallback.push('ABCDEFGHI');
      }
      return fallback;
    }

    const shuffled = [...wordList];
    this._shuffle(shuffled);

    const result = [];
    for (let i = 0; i < teamCount; i++) {
      result.push(shuffled[i % shuffled.length]);
    }

    return result;
  }

  // ─── Persistence (via TeamPuzzleSetRepository) ─────────────────

  async _persistAssignment(competitionId, roundId, teamId, word, puzzles) {
    const puzzleIds = puzzles.map(p => p.id).join(',');
    try {
      await this.repos.teamPuzzleSets.persist(competitionId, roundId, teamId, word, puzzleIds);
    } catch (e) {
      logger.error('Failed to persist team puzzle set', { roundId, teamId, error: e.message });
    }
  }

  async _loadExistingAssignments(roundId, teams, allPuzzles) {
    try {
      const rows = await this.repos.teamPuzzleSets.loadByRound(roundId);

      if (!rows || rows.length === 0) return null;

      // Check that all teams have assignments
      const assignedTeamIds = new Set(rows.map(r => r.team_id));
      const allTeamsHaveAssignment = teams.every(t => assignedTeamIds.has(t.id));
      if (!allTeamsHaveAssignment) return null;

      // Reconstruct puzzle arrays
      const puzzleMap = new Map();
      for (const p of allPuzzles) {
        puzzleMap.set(p.id, p);
      }

      const teamPuzzleMap = new Map();
      for (const row of rows) {
        const puzzleIds = row.puzzle_ids.split(',').map(Number);
        const puzzles = puzzleIds
          .map(id => puzzleMap.get(id))
          .filter(Boolean);

        if (puzzles.length === 0) return null; // Stale data, reassign

        // Re-apply word letters (they may have been overwritten)
        await this._assignWordLetters(puzzles, row.word);

        teamPuzzleMap.set(row.team_id, puzzles);
      }

      logger.info('Loaded existing puzzle assignments', { roundId, teamsCount: rows.length });
      return teamPuzzleMap;
    } catch (e) {
      return null;
    }
  }

  // ─── Utility ──────────────────────────────────────────────────

  _shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // ─── Admin helpers ────────────────────────────────────────────

  /**
   * Get assigned puzzle IDs for a team in a round.
   */
  async getTeamPuzzleIds(roundId, teamId) {
    try {
      const puzzleIds = await this.repos.teamPuzzleSets.getByTeam(roundId, teamId);
      if (!puzzleIds) return [];
      return puzzleIds.split(',').map(Number);
    } catch (e) {
      return [];
    }
  }

  /**
   * Get the word assigned to a team in a round.
   */
  async getTeamWord(roundId, teamId) {
    try {
      return await this.repos.teamPuzzleSets.getWord(roundId, teamId);
    } catch (e) {
      return null;
    }
  }

  /**
   * Reset assignments for a competition (admin operation).
   */
  async resetAssignments(roundId) {
    try {
      await this.repos.teamPuzzleSets.resetByRound(roundId);
    } catch (e) {
      logger.error('Failed to reset assignments', { roundId, error: e.message });
    }
  }
}

module.exports = PuzzleAssignmentService;
