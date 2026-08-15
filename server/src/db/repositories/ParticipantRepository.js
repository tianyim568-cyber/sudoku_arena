/**
 * Participant repository — abstracts participant (player) database operations.
 *
 * NOTE: This repository references multiple legacy tables dropped in migration 018:
 *   - `schools` table dropped — school info now stored as `school`/`province`
 *     columns directly on `players`
 *   - `tournament_participants` junction dropped — `players` now has a direct
 *     `competition_id` FK
 *   - `participants` table renamed/restructured to `players` (UUID PK,
 *     competition_id FK, user_id FK, name, school, province, age, category_id)
 *   - `users` table: `password` → `password_hash`, `display_name` removed,
 *     `role` values: SUPER_ADMIN/ORG_ADMIN/JUDGE/PLAYER
 *   - Columns `account`, `password`, `school_id` removed from players
 *
 * Public method names are kept identical so route handlers keep working.
 * Where a method no longer maps to a real table, it returns a sensible no-op
 * or empty result with a clear comment.
 */

const bcrypt = require('bcryptjs');

class ParticipantRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Find an existing school by name + province.
   *
   * The `schools` table no longer exists — school info lives on each player
   * row. This method is kept for backward compat with bulkImport callers but
   * returns a synthetic object { id, name, province } so downstream code that
   * references `school.id` still works.
   *
   * @param {Object} params
   * @param {string} params.name
   * @param {string} [params.province]
   * @param {string} [params.city]    - Ignored (no column).
   * @param {string} [params.district] - Ignored (no column).
   * @param {object} [tx] - Optional Prisma transaction client.
   * @returns {Promise<{id: string, name: string, province: string}>}
   */
  async findOrCreateSchool({ name, province, city, district }, tx) {
    // No schools table — return a synthetic stub. province is kept so
    // findOrCreateParticipant can copy it onto the player row.
    return {
      id: `school:${name}`,
      name,
      province: province || null,
    };
  }

  /**
   * Find an existing user by username, or create a PLAYER account.
   * If `plainPassword` is supplied and differs from the existing hash, the
   * hash is updated.
   * @param {Object} params
   * @param {string} params.username
   * @param {string} [params.displayName] - Ignored (display_name column removed).
   * @param {string} [params.plainPassword]
   * @param {object} [tx] - Optional Prisma transaction client.
   * @returns {Promise<object>} The user record.
   */
  async findOrCreateUser({ username, displayName, plainPassword }, tx) {
    const client = tx || this.prisma;
    const existing = await client.users.findUnique({ where: { username } });
    if (existing) {
      if (plainPassword) {
        const matches = bcrypt.compareSync(plainPassword, existing.password_hash);
        if (!matches) {
          const hash = bcrypt.hashSync(plainPassword, 10);
          return client.users.update({
            where: { id: existing.id },
            data: { password_hash: hash },
          });
        }
      }
      return existing;
    }

    const pw = plainPassword || (displayName || username) + '123';
    const hash = bcrypt.hashSync(pw, 10);
    return client.users.create({
      data: {
        username,
        password_hash: hash,
        role: 'PLAYER',
        // display_name removed in new schema — ignored.
      },
    });
  }

  /**
   * Find an existing player by user_id or by name+school, or create one.
   * @param {Object} params
   * @param {string} [params.userId]
   * @param {string} params.name
   * @param {number} [params.age]
   * @param {string} [params.category] - Legacy free-text; new schema uses category_id FK.
   *   When non-null we try to resolve it to a categories row by name; if not
   *   found, category_id is left null.
   * @param {string} [params.schoolId] - Legacy; ignored (school info stored inline).
   * @param {string} [params.school] - School name (used when creating).
   * @param {string} [params.province]
   * @param {string} [params.competitionId] - Required to create a player row
   *   (NOT NULL FK in new schema). If missing, creation will throw.
   * @param {object} [tx]
   * @returns {Promise<object>} The player record.
   */
  async findOrCreateParticipant(
    { name, age, category, schoolId, userId, school, province, competitionId },
    tx
  ) {
    const client = tx || this.prisma;

    if (userId) {
      const existing = await client.players.findFirst({ where: { user_id: userId } });
      if (existing) return existing;
    }

    if (school) {
      const existingByName = await client.players.findFirst({
        where: { name, school },
      });
      if (existingByName) return existingByName;
    } else {
      const existingByName = await client.players.findFirst({ where: { name } });
      if (existingByName) return existingByName;
    }

    // Resolve legacy free-text category to a category UUID (best-effort).
    let categoryId = null;
    if (category) {
      const cat = await client.categories.findFirst({ where: { name: category } });
      if (cat) categoryId = cat.id;
    }

    return client.players.create({
      data: {
        name,
        age: age || null,
        school: school || null,
        province: province || null,
        user_id: userId || null,
        competition_id: competitionId,
        category_id: categoryId,
      },
    });
  }

  /**
   * Link a participant to a competition with an optional team name.
   *
   * The `tournament_participants` junction no longer exists — the link is
   * represented by `players.competition_id`. This method is kept for backward
   * compat with bulkImport: if the player's competition_id already matches,
   * return null (already linked); otherwise update it.
   *
   * @param {Object} params
   * @param {string} params.competitionId - Competition UUID.
   * @param {string} params.participantId - Player UUID.
   * @param {string} [params.teamName] - Ignored (team membership is via team_members).
   * @param {object} [tx]
   * @returns {Promise<object|null>} The updated player, or null if already linked.
   */
  async linkToCompetition({ competitionId, participantId, teamName }, tx) {
    const client = tx || this.prisma;
    const existing = await client.players.findUnique({ where: { id: participantId } });
    if (!existing) return null;
    if (existing.competition_id === competitionId) return null;

    return client.players.update({
      where: { id: participantId },
      data: { competition_id: competitionId },
    });
  }

  /**
   * Get all participants for a competition, with school + user info.
   * @param {string} competitionId
   * @returns {Promise<object[]>}
   */
  async findByCompetition(competitionId) {
    const players = await this.prisma.players.findMany({
      where: { competition_id: competitionId },
      include: {
        users: { select: { username: true } },
        categories: { select: { name: true } },
        // The participants table shows a team column. The old schema stored
        // the name on the tournament_participants junction; the new one holds
        // the link in team_members, so the name has to be joined back or the
        // column renders empty for everyone.
        team_members: { include: { teams: { select: { name: true } } } },
      },
      orderBy: { created_at: 'asc' },
    });
    return players.map((p) => ({
      ...p,
      account: null, // account column removed
      password: null, // password column removed (use users.password_hash)
      school_name: p.school,
      category: p.categories?.name ?? null,
      username: p.users?.username ?? null,
      display_name: p.name, // display_name column removed; name is the closest
      team_name: p.team_members?.[0]?.teams?.name ?? null,
    }));
  }

  /**
   * Get participant data for export.
   *
   * The new schema no longer stores plain-text `account`/`password` on
   * players (security improvement). This method returns name + school + username
   * only; downstream exporters should be updated to stop expecting credentials.
   * @param {string} competitionId
   * @returns {Promise<object[]>}
   */
  async getExportData(competitionId) {
    const players = await this.prisma.players.findMany({
      where: { competition_id: competitionId },
      include: {
        users: { select: { username: true } },
        categories: { select: { name: true } },
      },
      orderBy: { created_at: 'asc' },
    });
    return players.map((p) => ({
      id: p.id,
      account: p.users?.username ?? null, // closest equivalent
      password: null, // no longer stored in plain text
      name: p.name,
      category: p.categories?.name ?? null,
      school_name: p.school,
    }));
  }

  /**
   * Delete all players for a competition.
   * Returns the count of deleted rows.
   * @param {string} competitionId
   * @returns {Promise<number>}
   */
  async deleteByCompetition(competitionId) {
    const count = await this.prisma.players.count({
      where: { competition_id: competitionId },
    });
    if (count > 0) {
      await this.prisma.players.deleteMany({
        where: { competition_id: competitionId },
      });
    }
    return count;
  }

  /**
   * Bulk import participants — all-or-nothing, wrapped in a transaction.
   *
   * Legacy behaviour stored an `account` string (year+competitionId+index) and a
   * plain-text password on each participant row. The new schema has no such
   * columns; we generate a username + hashed password on the `users` table
   * instead, and link each player to the competition via `competition_id`.
   *
   * @param {string} competitionId - Competition UUID.
   * @param {object[]} rows - each: { province, city, district, school, name, age, category, teamName }
   * @param {string} [year] - Ignored in new schema (was used for account string).
   * @returns {Promise<{imported: number}>}
   */
  async bulkImport(competitionId, rows, year = null) {
    return this.prisma.$transaction(async (tx) => {
      // Snapshot existing usernames inside the tx for accurate collision detection.
      const allUsers = await tx.users.findMany({ select: { username: true } });
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
            school: school.name,
            province: school.province,
            userId: user.id,
            competitionId: competitionId,
          },
          tx
        );

        // linkToCompetition is a near-no-op in the new schema (competition_id is
        // already set on the player). Kept for parity with legacy flow.
        const link = await this.linkToCompetition(
          { competitionId, participantId: participant.id, teamName: row.teamName || null },
          tx
        );

        // In the new schema, `link` is null (already linked via competition_id).
        // Count as imported as long as the player row exists and is attached.
        if (participant) imported++;
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
   */
  _generatePassword() {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const all = uppercase + lowercase + digits;

    let password = '';
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += digits[Math.floor(Math.random() * digits.length)];

    for (let i = 0; i < 3; i++) {
      password += all[Math.floor(Math.random() * all.length)];
    }

    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  /**
   * Generate account string: year + competitionId + zero-padded participant number.
   *
   * The new schema has no `account` column; this helper is kept for backward
   * compat with callers that still compute an account string, but its result
   * is not persisted anywhere.
   */
  _generateAccount(year, competitionId, participantIndex, totalCount) {
    const padWidth = String(totalCount).length;
    const paddedIndex = String(participantIndex).padStart(padWidth, '0');
    return `${year}${competitionId}${paddedIndex}`;
  }

  /**
   * Update participant credentials.
   *
   * The new `players` table has no `account`/`password` columns. This method
   * is kept for backward compat but updates the linked user's password_hash
   * instead (when a password is provided). The `account` parameter is ignored.
   * @param {string} participantId
   * @param {string} account - Ignored (no column).
   * @param {string} password - Plain text; will be hashed and stored on users.password_hash.
   * @param {object} [tx]
   */
  async updateCredentials(participantId, account, password, tx) {
    const client = tx || this.prisma;
    const player = await client.players.findUnique({
      where: { id: participantId },
      select: { user_id: true },
    });
    if (!player || !player.user_id || !password) return;

    const hash = bcrypt.hashSync(password, 10);
    await client.users.update({
      where: { id: player.user_id },
      data: { password_hash: hash },
    });
  }
}

module.exports = ParticipantRepository;
