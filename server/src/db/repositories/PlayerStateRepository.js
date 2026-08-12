/**
 * Player state repository — abstracts player_round_states and player_puzzle_assignments.
 * All methods are async (PostgreSQL).
 * INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
 * datetime("now") → NOW()
 *
 * @deprecated This repository references legacy tables dropped in migration 018:
 *   - `player_round_states` → replaced by `player_round_sessions` (UUID PK, round_id FK,
 *     participant_id FK, status: WAITING/PLAYING/SUBMITTED/AUTO_SUBMITTED)
 *   - `player_puzzle_assignments` → replaced by `puzzle_answers` (UUID PK, session_id FK,
 *     puzzle_id FK, JSONB current_grid, correct_cells, total_empty_cells, progress_percentage)
 * Key renames: `player_id` → `participant_id`, `is_completed` → status-based,
 *   `current_grid` TEXT → JSONB.
 * See DEVELOPMENT_PLAN.md Section 13 for the new schema.
 */

class PlayerStateRepository {
  constructor(db) {
    this.db = db;
  }

  // --- Player Round States ---

  async createRoundState({ roundId, playerId, teamId, status }) {
    await this.db.run(
      'INSERT INTO player_round_states (round_id, player_id, team_id, status) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [roundId, playerId, teamId, status || 'WAITING']
    );
  }

  // --- Player Puzzle Assignments ---

  async createAssignment({ roundId, playerId, puzzleId, teamId, currentGrid, isCompleted }) {
    await this.db.run(
      'INSERT INTO player_puzzle_assignments (round_id, player_id, puzzle_id, team_id, current_grid, is_completed) VALUES (?, ?, ?, ?, ?, ?)',
      [roundId, playerId, puzzleId, teamId, currentGrid, isCompleted ? 1 : 0]
    );
  }

  async findActiveAssignment(roundId, playerId, puzzleId) {
    return this.db.get(
      'SELECT * FROM player_puzzle_assignments WHERE round_id = ? AND player_id = ? AND puzzle_id = ? AND is_completed = 0',
      [roundId, playerId, puzzleId]
    );
  }

  async findAnyAssignment(roundId, playerId, puzzleId) {
    return this.db.get(
      'SELECT * FROM player_puzzle_assignments WHERE round_id = ? AND player_id = ? AND puzzle_id = ?',
      [roundId, playerId, puzzleId]
    );
  }

  async findPlayerAssignments(roundId, playerId) {
    return this.db.all(
      'SELECT p.*, ppa.current_grid, ppa.is_completed FROM puzzles p JOIN player_puzzle_assignments ppa ON p.id = ppa.puzzle_id WHERE ppa.round_id = ? AND ppa.player_id = ? AND ppa.is_completed = 0 ORDER BY p.order_in_round',
      [roundId, playerId]
    );
  }

  async findTeamAssignments(roundId, teamId) {
    return this.db.all(
      'SELECT * FROM player_puzzle_assignments WHERE round_id = ? AND team_id = ?',
      [roundId, teamId]
    );
  }

  async findTeamAssignmentsForPuzzle(roundId, puzzleId, teamId) {
    return this.db.all(
      'SELECT * FROM player_puzzle_assignments WHERE round_id = ? AND puzzle_id = ? AND team_id = ?',
      [roundId, puzzleId, teamId]
    );
  }

  async markCompleted(id) {
    await this.db.run('UPDATE player_puzzle_assignments SET is_completed = 1, completed_at = NOW() WHERE id = ?', [id]);
  }

  async markTeamAssignmentsCompleted(roundId, puzzleId, teamId) {
    const assignments = await this.findTeamAssignmentsForPuzzle(roundId, puzzleId, teamId);
    for (const ta of assignments) {
      await this.markCompleted(ta.id);
    }
  }

  async updateCurrentGrid(id, gridJSON) {
    await this.db.run('UPDATE player_puzzle_assignments SET current_grid = ? WHERE id = ?', [gridJSON, id]);
  }

  async deleteUncompletedAssignment(roundId, playerId, puzzleId) {
    await this.db.run(
      'DELETE FROM player_puzzle_assignments WHERE round_id = ? AND player_id = ? AND puzzle_id = ? AND is_completed = 0',
      [roundId, playerId, puzzleId]
    );
  }

  async findAssignedPuzzleIds(roundId, teamId) {
    const rows = await this.db.all(
      'SELECT DISTINCT puzzle_id FROM player_puzzle_assignments WHERE round_id = ? AND team_id = ?',
      [roundId, teamId]
    );
    return rows.map(a => a.puzzle_id);
  }
}

module.exports = PlayerStateRepository;
