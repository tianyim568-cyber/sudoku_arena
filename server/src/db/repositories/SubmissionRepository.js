/**
 * Submission repository — abstracts all submission-related database operations.
 * All methods are async (PostgreSQL).
 *
 * @deprecated This repository references the legacy `submissions` table (dropped in migration 018).
 * New schema replaces submissions with `puzzle_answers` table (UUID PK, session_id FK,
 * JSONB `current_grid`, `correct_cells`, `total_empty_cells`, `progress_percentage`).
 * Submissions are now tracked per-session via `player_round_sessions` + `puzzle_answers`.
 * See DEVELOPMENT_PLAN.md Section 13 for the new schema.
 */

class SubmissionRepository {
  constructor(db) {
    this.db = db;
  }

  async create({ roundId, playerId, puzzleId, teamId, submissionType, submittedValue, isCorrect, pointsEarned }) {
    await this.db.run(
      'INSERT INTO submissions (round_id, player_id, puzzle_id, team_id, submission_type, submitted_value, is_correct, points_earned) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [roundId, playerId, puzzleId, teamId, submissionType, submittedValue, isCorrect ? 1 : 0, pointsEarned || 0]
    );
  }

  async findTeamCorrect(roundId, teamId) {
    return this.db.all(
      'SELECT DISTINCT s.puzzle_id, p.letter, p.order_in_round, p.puzzle_type FROM submissions s JOIN puzzles p ON s.puzzle_id = p.id WHERE s.round_id = ? AND s.team_id = ? AND s.is_correct = 1 ORDER BY p.order_in_round',
      [roundId, teamId]
    );
  }

  async findTeamSolvedPuzzle(roundId, teamId, puzzleId) {
    return this.db.get(
      'SELECT * FROM submissions WHERE round_id = ? AND puzzle_id = ? AND team_id = ? AND is_correct = 1',
      [roundId, puzzleId, teamId]
    );
  }

  async findSolvedPuzzleIds(roundId, teamId) {
    const rows = await this.db.all(
      'SELECT DISTINCT puzzle_id FROM submissions WHERE round_id = ? AND team_id = ? AND is_correct = 1',
      [roundId, teamId]
    );
    return rows.map(r => r.puzzle_id);
  }

  async findTeamJocCorrect(roundId, teamId) {
    return this.db.all(
      `SELECT DISTINCT s.puzzle_id, p.letter, p.order_in_round
       FROM submissions s
       JOIN puzzles p ON s.puzzle_id = p.id
       JOIN (SELECT DISTINCT puzzle_id FROM player_puzzle_assignments WHERE round_id = ? AND team_id = ?) ppa
         ON s.puzzle_id = ppa.puzzle_id
       WHERE s.round_id = ? AND s.team_id = ? AND s.is_correct = 1 AND p.puzzle_type = ?
       ORDER BY p.order_in_round`,
      [roundId, teamId, roundId, teamId, 'JOC']
    );
  }
}

module.exports = SubmissionRepository;
