/**
 * Puzzle repository — abstracts all puzzle-related database operations.
 * All methods are async (PostgreSQL).
 */

class PuzzleRepository {
  constructor(db) {
    this.db = db;
  }

  async findById(id) {
    return this.db.get('SELECT * FROM puzzles WHERE id = ?', [id]);
  }

  async findByRound(roundId) {
    return this.db.all('SELECT * FROM puzzles WHERE round_id = ? ORDER BY order_in_round', [roundId]);
  }

  async findByRoundSummary(roundId) {
    return this.db.all(
      'SELECT id, puzzle_type, order_in_round, points, letter FROM puzzles WHERE round_id = ? ORDER BY order_in_round',
      [roundId]
    );
  }

  async findByRoundAndTeam(roundId, teamId) {
    return this.db.all(
      'SELECT * FROM puzzles WHERE round_id = ? AND (team_id = ? OR team_id IS NULL) ORDER BY order_in_round',
      [roundId, teamId]
    );
  }

  async findJocPuzzles(roundId) {
    return this.db.all(
      'SELECT * FROM puzzles WHERE round_id = ? AND puzzle_type = ? ORDER BY order_in_round',
      [roundId, 'JOC']
    );
  }

  /**
   * Find JOC puzzles assigned to a specific team in a round.
   */
  async findTeamJocPuzzles(roundId, teamId) {
    return this.db.all(
      `SELECT p.* FROM puzzles p
       JOIN (SELECT DISTINCT puzzle_id FROM player_puzzle_assignments WHERE round_id = ? AND team_id = ?) ppa
       ON p.id = ppa.puzzle_id
       WHERE p.round_id = ? AND p.puzzle_type = ?
       ORDER BY p.order_in_round`,
      [roundId, teamId, roundId, 'JOC']
    );
  }

  async findFinalPuzzles(roundId) {
    return this.db.all(
      'SELECT * FROM puzzles WHERE round_id = ? AND puzzle_type = ? ORDER BY order_in_round',
      [roundId, 'FINAL']
    );
  }

  async countByRound(roundId) {
    const row = await this.db.get('SELECT COUNT(*) as cnt FROM puzzles WHERE round_id = ?', [roundId]);
    return row?.cnt || 0;
  }

  async countJocByRound(roundId) {
    const row = await this.db.get(
      'SELECT COUNT(*) as cnt FROM puzzles WHERE round_id = ? AND puzzle_type = ?',
      [roundId, 'JOC']
    );
    return row?.cnt || 0;
  }

  /**
   * Count JOC puzzles assigned to a specific team in a round.
   */
  async countTeamJoc(roundId, teamId) {
    const row = await this.db.get(
      `SELECT COUNT(*) as cnt FROM puzzles p
       JOIN (SELECT DISTINCT puzzle_id FROM player_puzzle_assignments WHERE round_id = ? AND team_id = ?) ppa
       ON p.id = ppa.puzzle_id
       WHERE p.round_id = ? AND p.puzzle_type = ?`,
      [roundId, teamId, roundId, 'JOC']
    );
    return row?.cnt || 0;
  }

  /**
   * Find the FINAL puzzle assigned to a specific team in a round.
   */
  async findTeamFinalPuzzle(roundId, teamId) {
    return this.db.get(
      `SELECT p.* FROM puzzles p
       JOIN (SELECT DISTINCT puzzle_id FROM player_puzzle_assignments WHERE round_id = ? AND team_id = ?) ppa
       ON p.id = ppa.puzzle_id
       WHERE p.round_id = ? AND p.puzzle_type = ?`,
      [roundId, teamId, roundId, 'FINAL']
    );
  }

  /**
   * Count total puzzles assigned to a specific team in a round.
   */
  async countTeamPuzzles(roundId, teamId) {
    const row = await this.db.get(
      `SELECT COUNT(DISTINCT puzzle_id) as cnt FROM player_puzzle_assignments WHERE round_id = ? AND team_id = ?`,
      [roundId, teamId]
    );
    return row?.cnt || 0;
  }

  async create({ roundId, puzzleType, orderInRound, initialGrid, solution, points, letter, difficulty, teamId }) {
    await this.db.run(
      'INSERT INTO puzzles (round_id, puzzle_type, order_in_round, initial_grid, solution, points, letter, difficulty, team_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [roundId, puzzleType, orderInRound, initialGrid, solution, points || 100, letter || null, difficulty || null, teamId || null]
    );
  }

  async updateLetter(id, letter) {
    await this.db.run('UPDATE puzzles SET letter = ? WHERE id = ?', [letter, id]);
  }

  async updatePoints(id, points) {
    await this.db.run('UPDATE puzzles SET points = ? WHERE id = ?', [points, id]);
  }

  async updatePointsByRound(roundId, pointsPerPuzzle) {
    await this.db.run('UPDATE puzzles SET points = ? WHERE round_id = ?', [pointsPerPuzzle, roundId]);
  }

  async deleteByRound(roundId) {
    await this.db.run('DELETE FROM puzzles WHERE round_id = ?', [roundId]);
  }

  async deleteById(id) {
    await this.db.run('DELETE FROM puzzles WHERE id = ?', [id]);
  }

  async clearAll() {
    await this.db.run('DELETE FROM puzzles');
  }
}

module.exports = PuzzleRepository;
