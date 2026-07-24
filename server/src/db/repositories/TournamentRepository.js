/**
 * Tournament repository — abstracts all tournament-related database operations.
 * All methods are async (PostgreSQL). datetime('now') → NOW().
 */

class TournamentRepository {
  constructor(db) {
    this.db = db;
  }

  async findById(id) {
    return this.db.get('SELECT * FROM tournaments WHERE id = ?', [id]);
  }

  async findAll() {
    return this.db.all('SELECT * FROM tournaments ORDER BY id DESC');
  }

  async create({ name, description, scheduledTime, createdBy }) {
    await this.db.run(
      'INSERT INTO tournaments (name, description, status, scheduled_time, created_by) VALUES (?, ?, ?, ?, ?)',
      [name, description || '', 'PENDING', scheduledTime || null, createdBy]
    );
    return this.db.get('SELECT * FROM tournaments ORDER BY id DESC LIMIT 1');
  }

  async update(id, { name, description, scheduledTime }) {
    const existing = await this.findById(id);
    if (!existing) return null;
    await this.db.run(
      'UPDATE tournaments SET name=?, description=?, scheduled_time=?, updated_at=NOW() WHERE id=?',
      [name || existing.name, description ?? existing.description, scheduledTime ?? existing.scheduled_time, id]
    );
    return this.findById(id);
  }

  async updateStatus(id, status) {
    await this.db.run("UPDATE tournaments SET status = ?, updated_at = NOW() WHERE id = ?", [status, id]);
  }

  async deleteById(id) {
    await this.db.run('DELETE FROM tournaments WHERE id = ?', [id]);
  }

  /** Delete all dependent data for a tournament (submissions, scores, assignments, etc.) */
  async deleteCascade(id) {
    const rounds = await this.db.all('SELECT id FROM rounds WHERE tournament_id = ?', [id]);
    const roundIds = rounds.map(r => r.id);

    if (roundIds.length > 0) {
      const puzzleIds = [];
      for (const rid of roundIds) {
        const puzzles = await this.db.all('SELECT id FROM puzzles WHERE round_id = ?', [rid]);
        puzzles.forEach(p => puzzleIds.push(p.id));
      }
      for (const pid of puzzleIds) {
        await this.db.run('DELETE FROM submissions WHERE puzzle_id = ?', [pid]);
        await this.db.run('DELETE FROM player_puzzle_assignments WHERE puzzle_id = ?', [pid]);
        await this.db.run('DELETE FROM puzzle_relations WHERE puzzle_id = ? OR related_puzzle_id = ?', [pid, pid]);
      }
      for (const rid of roundIds) {
        await this.db.run('DELETE FROM player_puzzle_assignments WHERE round_id = ?', [rid]);
        await this.db.run('DELETE FROM player_round_states WHERE round_id = ?', [rid]);
        await this.db.run('DELETE FROM submissions WHERE round_id = ?', [rid]);
        await this.db.run('DELETE FROM puzzles WHERE round_id = ?', [rid]);
      }
      await this.db.run('DELETE FROM scores WHERE tournament_id = ?', [id]);
      await this.db.run('DELETE FROM rounds WHERE tournament_id = ?', [id]);
    }

    const teams = await this.db.all('SELECT id FROM teams WHERE tournament_id = ?', [id]);
    for (const team of teams) {
      await this.db.run('DELETE FROM team_members WHERE team_id = ?', [team.id]);
    }
    await this.db.run('DELETE FROM teams WHERE tournament_id = ?', [id]);
    await this.db.run('DELETE FROM tournament_judges WHERE tournament_id = ?', [id]);
    await this.db.run('DELETE FROM tournaments WHERE id = ?', [id]);
  }

  async findActiveRound(tournamentId) {
    return this.db.get(
      'SELECT * FROM rounds WHERE tournament_id = ? AND status IN (?, ?)',
      [tournamentId, 'IN_PROGRESS', 'PAUSED']
    );
  }
}

module.exports = TournamentRepository;
