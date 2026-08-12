/**
 * Participant repository — abstracts all participant-related database operations.
 * Handles schools, participants, and tournament-participant links.
 *
 * @deprecated This repository references multiple legacy tables dropped in migration 018:
 *   - `schools` table dropped — school info now stored as `school`/`province` columns on `participants`
 *   - `tournament_participants` junction table dropped — `participants` now has direct `competition_id` FK
 *   - `participants` table restructured: UUID PK, `competition_id` FK, `user_id` FK (UUID),
 *     `name`, `school`, `province`, `age`, `category`, `group_name`; columns `account`,
 *     `password`, `school_id` removed
 *   - User creation now uses `password_hash` (was `password`), `email` (new),
 *     `role` values updated (SUPER_ADMIN/ORG_ADMIN/JUDGE/PLAYER), `display_name` removed
 * See DEVELOPMENT_PLAN.md Section 13 for the new schema.
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
   * If `plainPassword` is supplied it will be hashed and stored; otherwise a
   * default password is generated from the display name.
   * Returns the user record.
   */
  async findOrCreateUser({ username, displayName, plainPassword }, tx) {
    const d = tx || this.db;
    const existing = await d.get('SELECT * FROM users WHERE username = ?', [username]);
    if (existing) {
      // If a new password was supplied, update the existing user's hash
      if (plainPassword) {
        const matches = bcrypt.compareSync(plainPassword, existing.password);
        if (!matches) {
          const hash = bcrypt.hashSync(plainPassword, 10);
          await d.run('UPDATE users SET password = ? WHERE id = ?', [hash, existing.id]);
          return { ...existing, password: hash };
        }
      }
      return existing;
    }

    const pw = plainPassword || (displayName || username) + '123';
    const defaultPw = bcrypt.hashSync(pw, 10);
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
      `SELECT tp.*, p.name, p.age, p.category, p.user_id, p.account, p.password,
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
   * Get participant data for export (includes credentials).
   * @param {number} tournamentId
   * @returns {Promise<object[]>}
   */
  async getExportData(tournamentId) {
    return this.db.all(
      `SELECT p.id, p.account, p.password, p.name, p.category, s.name as school_name
       FROM tournament_participants tp
       JOIN participants p ON tp.participant_id = p.id
       LEFT JOIN schools s ON p.school_id = s.id
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
   * Generates unique account credentials for each participant.
   *
   * @param {number} tournamentId
   * @param {object[]} rows - each: { province, city, district, school, name, age, category, teamName }
   * @param {string} [year] - tournament creation year (default: current year)
   * @returns {{ imported: number }} on success
   * @throws on first failure (triggers ROLLBACK)
   */
  async bulkImport(tournamentId, rows, year = null) {
    // Use provided year or extract from tournament
    const accountYear = year || new Date().getFullYear().toString();

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

        // Generate random password
        const password = this._generatePassword();

        const user = await this.findOrCreateUser(
          { username, displayName: row.name, plainPassword: password },
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

        // Generate account: year + tournamentId + zero-padded participant number
        const account = this._generateAccount(accountYear, tournamentId, i + 1, rows.length);

        // Store plain text account and password in participants table
        await this.updateCredentials(participant.id, account, password, tx);

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

  /**
   * Generate a random 6-character password with uppercase, lowercase, and digits.
   * @returns {string}
   */
  _generatePassword() {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const all = uppercase + lowercase + digits;

    let password = '';
    // Ensure at least one of each type
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += digits[Math.floor(Math.random() * digits.length)];

    // Fill remaining 3 characters randomly
    for (let i = 0; i < 3; i++) {
      password += all[Math.floor(Math.random() * all.length)];
    }

    // Shuffle the password
    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  /**
   * Generate account string: year + tournamentId + zero-padded participant number.
   * The participant number is zero-padded to match the digit count of the total number of participants.
   * E.g., 300 participants → 3-digit padding (001, 002, ..., 300)
   *       10 participants  → 2-digit padding (01, 02, ..., 10)
   * @param {string} year - tournament creation year
   * @param {number} tournamentId
   * @param {number} participantIndex - 1-based index of this participant in the import batch
   * @param {number} totalCount - total number of participants being imported
   * @returns {string}
   */
  _generateAccount(year, tournamentId, participantIndex, totalCount) {
    const padWidth = String(totalCount).length;
    const paddedIndex = String(participantIndex).padStart(padWidth, '0');
    return `${year}${tournamentId}${paddedIndex}`;
  }

  /**
   * Update participant credentials (account and password) in the participants table.
   * @param {number} participantId
   * @param {string} account
   * @param {string} password - plain text
   * @param {object} [tx] - optional transaction
   */
  async updateCredentials(participantId, account, password, tx) {
    const d = tx || this.db;
    await d.run(
      'UPDATE participants SET account = ?, password = ? WHERE id = ?',
      [account, password, participantId]
    );
  }

}

module.exports = ParticipantRepository;
