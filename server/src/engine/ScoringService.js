/**
 * ScoringService — idempotent score operations.
 *
 * All score mutations go through repository `addTeamPoints` / `addPlayerPoints`
 * which use upsert semantics (INSERT ... ON CONFLICT UPDATE).
 * This service adds domain logic on top: time bonuses, difficulty points, etc.
 */

class ScoringService {
  /**
   * @param {import('../db/repositories/ScoreRepository')} scoreRepo
   */
  constructor(scoreRepo) {
    this.scoreRepo = scoreRepo;
  }

  // ─── Core score mutations ─────────────────────────────────────

  /**
   * Add points to a team's round score (idempotent upsert).
   * @returns {number} updated total
   */
  async addTeamPoints(competitionId, roundId, teamId, points) {
    await this.scoreRepo.addTeamPoints(competitionId, roundId, teamId, points);
    const score = await this.scoreRepo.findTeamScore(competitionId, roundId, teamId);
    return score?.total_points || 0;
  }

  /**
   * Add points to a player's round score (idempotent upsert).
   * @returns {number} updated total
   */
  async addPlayerPoints(competitionId, roundId, playerId, teamId, points) {
    await this.scoreRepo.addPlayerPoints(competitionId, roundId, playerId, teamId, points);
    const score = await this.scoreRepo.findPlayerScore(competitionId, roundId, playerId);
    return score?.total_points || 0;
  }

  // ─── Queries ──────────────────────────────────────────────────

  async findTeamScore(competitionId, roundId, teamId) {
    return await this.scoreRepo.findTeamScore(competitionId, roundId, teamId);
  }

  async findPlayerScore(competitionId, roundId, playerId) {
    return await this.scoreRepo.findPlayerScore(competitionId, roundId, playerId);
  }

  async findTeamScoresByCompetition(competitionId) {
    return await this.scoreRepo.findTeamScoresByCompetition(competitionId);
  }

  async findPlayerScoresByCompetition(competitionId, playerId) {
    return await this.scoreRepo.findPlayerScoresByCompetition(competitionId, playerId);
  }

  // ─── Round 1 time bonus ───────────────────────────────────────

  /**
   * Round 1 time bonus: +3 points per full minute remaining.
   * Applied only when all puzzles in the round are completed.
   * @param {string} competitionId
   * @param {number} roundId
   * @param {number} teamId
   * @param {number} remainingSeconds
   * @param {number} solvedCount
   * @param {number} totalPuzzles
   * @returns {number} bonus points applied (0 if none)
   */
  async applyRound1TimeBonus(competitionId, roundId, teamId, remainingSeconds, solvedCount, totalPuzzles) {
    if (solvedCount < totalPuzzles || totalPuzzles === 0 || remainingSeconds <= 0) return 0;

    const bonusMinutes = Math.floor(remainingSeconds / 60);
    const timeBonus = bonusMinutes * 3;
    if (timeBonus <= 0) return 0;

    await this.scoreRepo.addTeamPoints(competitionId, roundId, teamId, timeBonus);
    return timeBonus;
  }

  // ─── Round 2 difficulty points ────────────────────────────────

  /**
   * Round 2 points based on puzzle difficulty.
   * Easy=8, Medium=16, Hard=20
   * @param {string} difficulty
   * @returns {number}
   */
  getRound2DifficultyPoints(difficulty) {
    const map = { EASY: 8, MEDIUM: 16, HARD: 20 };
    return map[difficulty] || 16;
  }

  /**
   * Round 2 completion bonus: +3 pts/min remaining when all puzzles solved.
   * @param {string} competitionId
   * @param {number} roundId
   * @param {number} teamId
   * @param {number} remainingSeconds
   * @param {number} solvedCount
   * @param {number} totalPuzzles
   * @returns {number} bonus points applied (0 if none)
   */
  async applyRound2CompletionBonus(competitionId, roundId, teamId, remainingSeconds, solvedCount, totalPuzzles) {
    if (solvedCount < totalPuzzles || totalPuzzles === 0 || remainingSeconds <= 0) return 0;

    const bonusMinutes = Math.floor(remainingSeconds / 60);
    const completionBonus = bonusMinutes * 3;
    if (completionBonus <= 0) return 0;

    await this.scoreRepo.addTeamPoints(competitionId, roundId, teamId, completionBonus);
    return completionBonus;
  }

  // ─── Round 3 difficulty points ─────────────────────────────────

  /**
   * Round 3 points based on puzzle difficulty.
   * Easy=10, Medium=20, Hard=45
   * @param {string} difficulty
   * @returns {number}
   */
  getRound3DifficultyPoints(difficulty) {
    const map = { EASY: 10, MEDIUM: 20, HARD: 45 };
    return map[difficulty] || 10;
  }

  /**
   * Round 3 completion bonus: +5 pts/min remaining when all puzzles solved.
   * @param {string} competitionId
   * @param {number} roundId
   * @param {number} teamId
   * @param {number} remainingSeconds
   * @param {number} solvedCount
   * @param {number} totalPuzzles
   * @returns {number} bonus points applied (0 if none)
   */
  async applyRound3CompletionBonus(competitionId, roundId, teamId, remainingSeconds, solvedCount, totalPuzzles) {
    if (solvedCount < totalPuzzles || totalPuzzles === 0 || remainingSeconds <= 0) return 0;

    const bonusMinutes = Math.floor(remainingSeconds / 60);
    const completionBonus = bonusMinutes * 5;
    if (completionBonus <= 0) return 0;

    await this.scoreRepo.addTeamPoints(competitionId, roundId, teamId, completionBonus);
    return completionBonus;
  }

  // ─── Individual round completion scoring ──────────────────────────

  /**
   * Calculate completion-based score for individual rounds.
   * Pure function — no database operations.
   *
   * Formula: puzzleScore = Math.round(maxPoints * correctlyFilledCells / totalOriginallyEmptyCells)
   *
   * @param {number[][]} initialGrid - Original puzzle grid (0 = empty)
   * @param {number[][]} solution - Complete solution grid
   * @param {number[][]} playerGrid - Player's current grid
   * @returns {{totalOriginallyEmptyCells: number, correctlyFilledCells: number, completionRatio: number}}
   */
  calculateCompletion(initialGrid, solution, playerGrid) {
    let totalOriginallyEmptyCells = 0;
    let correctlyFilledCells = 0;

    for (let row = 0; row < initialGrid.length; row++) {
      for (let col = 0; col < initialGrid[row].length; col++) {
        // Only count cells that were originally empty
        if (initialGrid[row][col] === 0) {
          totalOriginallyEmptyCells++;

          // Check if player filled this cell correctly
          if (playerGrid[row]?.[col] === solution[row][col]) {
            correctlyFilledCells++;
          }
        }
      }
    }

    const completionRatio = totalOriginallyEmptyCells > 0
      ? correctlyFilledCells / totalOriginallyEmptyCells
      : 0;

    return {
      totalOriginallyEmptyCells,
      correctlyFilledCells,
      completionRatio,
    };
  }
}

module.exports = ScoringService;
