/**
 * Participant repository — abstracts all participant-related database operations.
 * Handles schools, participants, and tournament-participant links.
 */

const bcrypt = require('bcryptjs');

class ParticipantRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Find an existing school by name+location, or create it.
   * Returns the school record.
   * When `tx` is supplied the operation runs inside that transaction.
   */
  async findOrCreateSchool({ name, province, city, district }, tx) {
    const d = tx || this.db;
    const existing = await d.get(
      'SELECT * FROM schools WHERE name = ? AND COALESCE(province, \'\') = ? AND COALESCE(city, \'\') = ? AND COALESCE(district, \'\') = ?',
      [name, province || '', city || '', district || '']
    );
    if (existing) return existing;

    await d.run(
      'INSERT INTO schools (name, province, city, district) VALUES (?, ?, ?, ?)',
      [name, province || null, city || null, district || null]
    );
    return d.get('SELECT * FROM schools ORDER BY id DESC LIMIT 1');
  }

  /**
   * Find an existing user by username, or create a PLAYER account.
   * Returns the user record.
   */
  async findOrCreateUser({ username, displayName }, tx) {
    const d = tx || this.db;
    const existing = await d.get('SELECT * FROM users WHERE username = ?', [username]);
    if (existing) return existing;

    const defaultPw = bcrypt.hashSync((displayName || username) + '123', 10);
    await d.run(
      'INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?)',
      [username, defaultPw, 'PLAYER', displayName || username]
    );
    return d.get('SELECT * FROM users ORDER BY id DESC LIMIT 1');
  }

  /**
   * Find an existing participant by name+school, or create one.
   * Returns the participant record.
   */
  async findOrCreateParticipant({ name, age, category, schoolId, userId }, tx) {
    const d = tx || this.db;
    if (userId) {
      const existing = await d.get('SELECT * FROM participants WHERE user_id = ?', [userId]);
      if (existing) return existing;
    }

    const existingByName = await d.get(
      'SELECT * FROM participants WHERE name = ? AND school_id = ?',
      [name, schoolId]
    );
    if (existingByName) return existingByName;

    await d.run(
      'INSERT INTO participants (user_id, name, age, category, school_id) VALUES (?, ?, ?, ?, ?)',
      [userId || null, name, age || null, category || null, schoolId || null]
    );
    return d.get('SELECT * FROM participants ORDER BY id DESC LIMIT 1');
  }

  /**
   * Link a participant to a tournament with an optional team name.
   * Returns the link row on success, or null if already linked.
   */
  async linkToTournament({ tournamentId, participantId, teamName }, tx) {
    const d = tx || this.db;
    const existing = await d.get(
      'SELECT * FROM tournament_participants WHERE tournament_id = ? AND participant_id = ?',
      [tournamentId, participantId]
    );
    if (existing) return null;

    await d.run(
      'INSERT INTO tournament_participants (tournament_id, participant_id, team_name) VALUES (?, ?, ?)',
      [tournamentId, participantId, teamName || null]
    );
    return d.get('SELECT * FROM tournament_participants ORDER BY id DESC LIMIT 1');
  }

  /**
   * Get all participants for a tournament, with school info.
   */
  async findByTournament(tournamentId) {
    return this.db.all(
      `SELECT tp.*, p.name, p.age, p.category, p.user_id,
              s.name as school_name, s.province, s.city, s.district,
              u.username, u.display_name
       FROM tournament_participants tp
       JOIN participants p ON tp.participant_id = p.id
       LEFT JOIN schools s ON p.school_id = s.id
       LEFT JOIN users u ON p.user_id = u.id
       WHERE tp.tournament_id = ?
       ORDER BY tp.id`,
      [tournamentId]
    );
  }

  /**
   * Delete all tournament_participants for a tournament.
   * Returns the count of deleted rows.
   */
  async deleteByTournament(tournamentId) {
    const before = await this.db.get(
      'SELECT COUNT(*) as cnt FROM tournament_participants WHERE tournament_id = ?',
      [tournamentId]
    );
    await this.db.run('DELETE FROM tournament_participants WHERE tournament_id = ?', [tournamentId]);
    return parseInt(before.cnt);
  }

  /**
   * Bulk import — all-or-nothing, wrapped in a single transaction.
   * If any row fails, the entire batch is rolled back.
   *
   * @param {number} tournamentId
   * @param {object[]} rows - each: { province, city, district, school, name, age, category, teamName }
   * @returns {{ imported: number }} on success
   * @throws on first failure (triggers ROLLBACK)
   */
  async bulkImport(tournamentId, rows) {
    return this.db.transaction(async (tx) => {
      // Load existing usernames inside the transaction for an accurate snapshot
      const allUsers = await tx.all('SELECT username FROM users');
      const existingUsernames = new Set(allUsers.map((u) => u.username));

      let imported = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        const school = await this.findOrCreateSchool(
          { name: row.school, province: row.province, city: row.city, district: row.district },
          tx
        );

        const username = this._generateUsername(row.school, row.name, existingUsernames);
        existingUsernames.add(username);

        const user = await this.findOrCreateUser(
          { username, displayName: row.name },
          tx
        );

        const participant = await this.findOrCreateParticipant(
          {
            name: row.name,
            age: row.age ? parseInt(row.age) : null,
            category: row.category || null,
            schoolId: school.id,
            userId: user.id,
          },
          tx
        );

        const link = await this.linkToTournament(
          { tournamentId, participantId: participant.id, teamName: row.teamName || null },
          tx
        );

        if (link) imported++;
      }

      return { imported };
    });
  }

  /**
   * Generate a unique username from school name and student name.
   * Format: school_name (pinyin-style simplified), with numeric suffix on collision.
   */
  _generateUsername(school, name, existingUsernames) {
    const sanitize = (s) => (s || '').replace(/[^a-zA-Z0-9一-鿿]/g, '').toLowerCase();
    const base = `${sanitize(school)}_${sanitize(name)}`;

    if (!existingUsernames.has(base)) return base;

    let suffix = 2;
    while (existingUsernames.has(`${base}${suffix}`)) {
      suffix++;
    }
    return `${base}${suffix}`;
  }
}

module.exports = ParticipantRepository;
