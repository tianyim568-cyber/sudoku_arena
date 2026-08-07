/**
 * PlayerRepository — abstracts player-related database operations.
 * Works with the new `players` table (renamed from `participants` in migration 042).
 *
 * Schema:
 *   - id (uuid PK)
 *   - competition_id (uuid FK to competitions)
 *   - user_id (uuid FK to users)
 *   - name (varchar)
 *   - school (varchar)
 *   - province (varchar)
 *   - age (integer)
 *   - category_id (uuid FK to categories)
 *   - created_at (timestamptz)
 */

class PlayerRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Find player by ID.
   * @param {string} id - Player UUID
   * @returns {Promise<object|null>}
   */
  async findById(id) {
    return this.db.get('SELECT * FROM players WHERE id = ?', [id]);
  }

  /**
   * Find player by user_id.
   * @param {string} userId - User UUID
   * @returns {Promise<object|null>}
   */
  async findByUserId(userId) {
    return this.db.get('SELECT * FROM players WHERE user_id = ?', [userId]);
  }

  /**
   * Find all players for a competition.
   * @param {string} competitionId - Competition UUID
   * @returns {Promise<object[]>}
   */
  async findByCompetition(competitionId) {
    return this.db.all(
      `SELECT p.*, c.name as category_name, u.username, u.role
       FROM players p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.competition_id = ?
       ORDER BY p.created_at`,
      [competitionId]
    );
  }

  /**
   * Find players by category for a competition.
   * @param {string} competitionId - Competition UUID
   * @param {string} categoryId - Category UUID
   * @returns {Promise<object[]>}
   */
  async findByCompetitionAndCategory(competitionId, categoryId) {
    return this.db.all(
      `SELECT p.*, c.name as category_name, u.username, u.role
       FROM players p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.competition_id = ? AND p.category_id = ?
       ORDER BY p.created_at`,
      [competitionId, categoryId]
    );
  }

  /**
   * Create a new player.
   * @param {object} playerData
   * @param {string} playerData.competitionId - Competition UUID
   * @param {string} [playerData.userId] - User UUID (optional)
   * @param {string} playerData.name - Player name
   * @param {string} [playerData.school] - School name
   * @param {string} [playerData.province] - Province
   * @param {number} [playerData.age] - Age
   * @param {string} [playerData.categoryId] - Category UUID
   * @returns {Promise<object>} Created player
   */
  async create(playerData) {
    await this.db.run(
      `INSERT INTO players (competition_id, user_id, name, school, province, age, category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        playerData.competitionId,
        playerData.userId || null,
        playerData.name,
        playerData.school || null,
        playerData.province || null,
        playerData.age || null,
        playerData.categoryId || null,
      ]
    );
    return this.db.get(
      'SELECT * FROM players WHERE competition_id = ? AND name = ? ORDER BY created_at DESC LIMIT 1',
      [playerData.competitionId, playerData.name]
    );
  }

  /**
   * Update player details.
   * @param {string} id - Player UUID
   * @param {object} updates - Fields to update
   * @returns {Promise<object>} Updated player
   */
  async update(id, updates) {
    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.school !== undefined) {
      fields.push('school = ?');
      values.push(updates.school);
    }
    if (updates.province !== undefined) {
      fields.push('province = ?');
      values.push(updates.province);
    }
    if (updates.age !== undefined) {
      fields.push('age = ?');
      values.push(updates.age);
    }
    if (updates.categoryId !== undefined) {
      fields.push('category_id = ?');
      values.push(updates.categoryId);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    await this.db.run(
      `UPDATE players SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
    return this.findById(id);
  }

  /**
   * Delete a player by ID.
   * @param {string} id - Player UUID
   * @returns {Promise<void>}
   */
  async delete(id) {
    await this.db.run('DELETE FROM players WHERE id = ?', [id]);
  }

  /**
   * Delete all players for a competition.
   * @param {string} competitionId - Competition UUID
   * @returns {Promise<number>} Number of deleted players
   */
  async deleteByCompetition(competitionId) {
    const result = await this.db.get(
      'SELECT COUNT(*) as count FROM players WHERE competition_id = ?',
      [competitionId]
    );
    await this.db.run('DELETE FROM players WHERE competition_id = ?', [competitionId]);
    return parseInt(result.count, 10);
  }

  /**
   * Count players in a competition.
   * @param {string} competitionId - Competition UUID
   * @returns {Promise<number>}
   */
  async countByCompetition(competitionId) {
    const result = await this.db.get(
      'SELECT COUNT(*) as count FROM players WHERE competition_id = ?',
      [competitionId]
    );
    return parseInt(result.count, 10);
  }

  /**
   * Count players by category in a competition.
   * @param {string} competitionId - Competition UUID
   * @param {string} categoryId - Category UUID
   * @returns {Promise<number>}
   */
  async countByCompetitionAndCategory(competitionId, categoryId) {
    const result = await this.db.get(
      'SELECT COUNT(*) as count FROM players WHERE competition_id = ? AND category_id = ?',
      [competitionId, categoryId]
    );
    return parseInt(result.count, 10);
  }
}

module.exports = PlayerRepository;
