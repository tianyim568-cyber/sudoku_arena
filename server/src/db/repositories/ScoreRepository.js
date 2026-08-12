/**
 * Score repository — abstracts all score-related database operations.
 * Uses idempotent upsert semantics to prevent double-scoring.
 * All methods are async (PostgreSQL). datetime("now") → NOW().
 *
 * @deprecated This repository references the legacy `scores` table (dropped in migration 018).
 * New schema replaces scores with:
 *   - `round_rankings` (UUID PK, round_id FK, participant_id/team_id, score, rank)
 *   - `final_rankings` (UUID PK, competition_id FK, category, competition_type, entity_id, rank, score)
 * Rankings are now snapshot-based, computed after round/competition completion.
 * See DEVELOPMENT_PLAN.md Section 13 for the new schema.
 */

class ScoreRepository {
  constructor(db) {
    this.db = db;
  }

  async findTeamScore(tournamentId, roundId, teamId) {
    return this.db.get(
      'SELECT total_points FROM scores WHERE tournament_id = ? AND round_id = ? AND team_id = ? AND score_type = ?',
      [tournamentId, roundId, teamId, 'TEAM']
    );
  }

  async findTeamScoreRow(tournamentId, roundId, teamId) {
    return this.db.get(
      'SELECT * FROM scores WHERE tournament_id = ? AND round_id = ? AND team_id = ? AND score_type = ?',
      [tournamentId, roundId, teamId, 'TEAM']
    );
  }

  async findPlayerScore(tournamentId, roundId, playerId) {
    return this.db.get(
      'SELECT total_points FROM scores WHERE tournament_id = ? AND round_id = ? AND player_id = ? AND score_type = ?',
      [tournamentId, roundId, playerId, 'INDIVIDUAL']
    );
  }

  async findPlayerScoreRow(tournamentId, roundId, playerId) {
    return this.db.get(
      'SELECT * FROM scores WHERE tournament_id = ? AND round_id = ? AND player_id = ? AND score_type = ?',
      [tournamentId, roundId, playerId, 'INDIVIDUAL']
    );
  }

  async findTeamScoresByTournament(tournamentId) {
    return this.db.all(
      'SELECT s.*, t.name as team_name, r.name as round_name FROM scores s JOIN teams t ON s.team_id = t.id JOIN rounds r ON s.round_id = r.id WHERE s.tournament_id = ? AND s.score_type = ?',
      [tournamentId, 'TEAM']
    );
  }

  async findPlayerScoresByTournament(tournamentId) {
    return this.db.all(
      'SELECT s.*, r.name as round_name FROM scores s JOIN rounds r ON s.round_id = r.id WHERE s.tournament_id = ? AND s.player_id = ? AND s.score_type = ?',
      [tournamentId, 'INDIVIDUAL']
    );
  }

  /**
   * Add points to a team score. Creates the row if it doesn't exist (idempotent upsert).
   */
  async addTeamPoints(tournamentId, roundId, teamId, points) {
    const existing = await this.findTeamScoreRow(tournamentId, roundId, teamId);
    if (existing) {
      await this.db.run(
        'UPDATE scores SET total_points = total_points + ?, updated_at = NOW() WHERE id = ?',
        [points, existing.id]
      );
    } else {
      await this.db.run(
        'INSERT INTO scores (tournament_id, round_id, team_id, score_type, total_points) VALUES (?, ?, ?, ?, ?)',
        [tournamentId, roundId, teamId, 'TEAM', points]
      );
    }
  }

  /**
   * Add points to an individual player score. Creates the row if it doesn't exist.
   */
  async addPlayerPoints(tournamentId, roundId, playerId, teamId, points) {
    const existing = await this.findPlayerScoreRow(tournamentId, roundId, playerId);
    if (existing) {
      await this.db.run(
        'UPDATE scores SET total_points = total_points + ?, updated_at = NOW() WHERE id = ?',
        [points, existing.id]
      );
    } else {
      await this.db.run(
        'INSERT INTO scores (tournament_id, round_id, player_id, team_id, score_type, total_points) VALUES (?, ?, ?, ?, ?, ?)',
        [tournamentId, roundId, playerId, teamId, 'INDIVIDUAL', points]
      );
    }
  }

  async deleteByTournament(tournamentId) {
    await this.db.run('DELETE FROM scores WHERE tournament_id = ?', [tournamentId]);
  }
}

module.exports = ScoreRepository;
