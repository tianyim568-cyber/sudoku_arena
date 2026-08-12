/**
 * TeamPuzzleSetRepository — abstracts team_puzzle_sets table operations.
 * Extracted from PuzzleAssignmentService (SRP).
 * All methods are async (PostgreSQL).
 * INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
 *
 * @deprecated This repository references the legacy `team_puzzle_sets` table (dropped in migration 018).
 * New schema replaces this with `round_puzzles` junction table (UUID PK, round_id FK,
 * puzzle_id FK, order_number, score) for puzzle-to-round assignment, and the
 * `puzzle_sets` + `puzzles` two-table model for puzzle library management.
 * See DEVELOPMENT_PLAN.md Section 13 for the new schema.
 */

class TeamPuzzleSetRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Persist a team-puzzle assignment.
   * @param {number} tournamentId
   * @param {number} roundId
   * @param {number} teamId
   * @param {string} word
   * @param {string} puzzleIds - comma-separated puzzle IDs
   */
  async persist(tournamentId, roundId, teamId, word, puzzleIds) {
    await this.db.run(
      'INSERT INTO team_puzzle_sets (tournament_id, round_id, team_id, word, puzzle_ids) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [tournamentId, roundId, teamId, word, puzzleIds]
    );
  }

  /**
   * Load all assignments for a round.
   * @param {number} roundId
   * @returns {Array<{team_id: number, word: string, puzzle_ids: string}>}
   */
  async loadByRound(roundId) {
    return this.db.all(
      'SELECT team_id, word, puzzle_ids FROM team_puzzle_sets WHERE round_id = ?',
      [roundId]
    );
  }

  /**
   * Get puzzle IDs for a team in a round.
   * @param {number} roundId
   * @param {number} teamId
   * @returns {string|null} comma-separated puzzle IDs
   */
  async getByTeam(roundId, teamId) {
    const row = await this.db.get(
      'SELECT puzzle_ids FROM team_puzzle_sets WHERE round_id = ? AND team_id = ?',
      [roundId, teamId]
    );
    return row?.puzzle_ids || null;
  }

  /**
   * Get the word for a team in a round.
   * @param {number} roundId
   * @param {number} teamId
   * @returns {string|null}
   */
  async getWord(roundId, teamId) {
    const row = await this.db.get(
      'SELECT word FROM team_puzzle_sets WHERE round_id = ? AND team_id = ?',
      [roundId, teamId]
    );
    return row?.word || null;
  }

  /**
   * Reset all assignments for a round.
   * @param {number} roundId
   */
  async resetByRound(roundId) {
    await this.db.run(
      'DELETE FROM team_puzzle_sets WHERE round_id = ?',
      [roundId]
    );
  }
}

module.exports = TeamPuzzleSetRepository;
