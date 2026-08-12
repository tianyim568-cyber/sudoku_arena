/**
 * Round repository — abstracts all round-related database operations.
 * All methods are async (PostgreSQL). datetime('now') → NOW().
 *
 * @deprecated This repository references the legacy schema (dropped in migration 018).
 * New schema changes:
 *   - Table `rounds` now has UUID PK, `stage_id` FK (→ competition_stages), `type` (was `round_type`),
 *     `order_number` (was `round_number`), `waiting_seconds` (new), status values: WAITING/RUNNING/FINISHED
 *   - Rounds no longer have `tournament_id` — they belong to a `competition_stage` which belongs to a `competition`
 *   - `remaining_seconds` column removed — timing handled in application layer
 * See DEVELOPMENT_PLAN.md Section 13 for the new schema.
 */

class RoundRepository {
  constructor(db) {
    this.db = db;
  }

  async findById(id) {
    return this.db.get('SELECT * FROM rounds WHERE id = ?', [id]);
  }

  async findByTournament(tournamentId) {
    return this.db.all('SELECT * FROM rounds WHERE tournament_id = ? ORDER BY round_number', [tournamentId]);
  }

  async findByTournamentAndStatus(tournamentId, status) {
    return this.db.get('SELECT * FROM rounds WHERE tournament_id = ? AND status = ?', [tournamentId, status]);
  }

  async findByTournamentNotStatus(tournamentId, status) {
    return this.db.all('SELECT * FROM rounds WHERE tournament_id = ? AND status != ?', [tournamentId, status]);
  }

  async create({ tournamentId, roundNumber, name, roundType, durationSeconds }) {
    await this.db.run(
      'INSERT INTO rounds (tournament_id, round_number, name, round_type, duration_seconds, status) VALUES (?, ?, ?, ?, ?, ?)',
      [tournamentId, roundNumber, name, roundType, durationSeconds, 'NOT_STARTED']
    );
    return this.db.get('SELECT * FROM rounds ORDER BY id DESC LIMIT 1');
  }

  async updateStatus(id, status, extraFields = {}) {
    const sets = ['status = ?'];
    const params = [status];
    if (extraFields.started_at) { sets.push('started_at = ?'); params.push(extraFields.started_at); }
    if (extraFields.ended_at) { sets.push('ended_at = ?'); params.push(extraFields.ended_at); }
    if (extraFields.remaining_seconds !== undefined) { sets.push('remaining_seconds = ?'); params.push(extraFields.remaining_seconds); }
    params.push(id);
    await this.db.run(`UPDATE rounds SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async startRound(id, durationSeconds) {
    await this.db.run(
      "UPDATE rounds SET status = 'IN_PROGRESS', started_at = NOW(), remaining_seconds = ? WHERE id = ?",
      [durationSeconds, id]
    );
  }

  async finishRound(id) {
    await this.db.run(
      "UPDATE rounds SET status = 'FINISHED', ended_at = NOW(), remaining_seconds = 0 WHERE id = ?",
      [id]
    );
  }

  async pauseRound(id, remainingSeconds) {
    await this.db.run('UPDATE rounds SET status = ?, remaining_seconds = ? WHERE id = ?', ['PAUSED', remainingSeconds, id]);
  }

  async resumeRound(id) {
    await this.db.run("UPDATE rounds SET status = 'IN_PROGRESS' WHERE id = ?", [id]);
  }

  async countByTournament(tournamentId) {
    const rounds = await this.db.all('SELECT * FROM rounds WHERE tournament_id = ?', [tournamentId]);
    return rounds.length;
  }

  async findWithPuzzles(tournamentId) {
    const rounds = await this.findByTournament(tournamentId);
    for (const r of rounds) {
      r.puzzles = await this.db.all(
        'SELECT id, puzzle_type, order_in_round, points, letter FROM puzzles WHERE round_id = ? ORDER BY order_in_round',
        [r.id]
      );
    }
    return rounds;
  }
}

module.exports = RoundRepository;
