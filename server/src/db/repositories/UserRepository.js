/**
 * User repository — abstracts all user-related database operations.
 * All methods are async (PostgreSQL).
 *
 * Schema (migration 020): users table with UUID primary keys, organization_id FK,
 * password_hash (bcrypt), email, role (SUPER_ADMIN/ORG_ADMIN/JUDGE/PLAYER), status.
 */

class UserRepository {
  /**
   * @param {{ run: Function, all: Function, get: Function }} db
   */
  constructor(db) {
    this.db = db;
  }

  async findById(id) {
    return this.db.get('SELECT id, organization_id, username, role, status, created_at FROM users WHERE id = ?', [id]);
  }

  async findByUsername(username) {
    return this.db.get('SELECT * FROM users WHERE username = ?', [username]);
  }

  async findByUsernameSafe(username) {
    return this.db.get('SELECT id, organization_id, username, role, status FROM users WHERE username = ?', [username]);
  }

  async findAll() {
    return this.db.all('SELECT id, organization_id, username, role, status, created_at FROM users ORDER BY created_at');
  }

  async findByRole(role) {
    return this.db.all('SELECT * FROM users WHERE role = ?', [role]);
  }

  async findByOrganization(organizationId) {
    return this.db.all('SELECT * FROM users WHERE organization_id = ?', [organizationId]);
  }

  async create({ username, password, role, organizationId }) {
    await this.db.run(
      'INSERT INTO users (username, password_hash, role, organization_id, status) VALUES (?, ?, ?, ?, ?)',
      [username, password, role, organizationId || null, 'ACTIVE']
    );
    return this.db.get('SELECT id, organization_id, username, role, status FROM users WHERE username = ?', [username]);
  }

  async updateStatus(id, status) {
    await this.db.run('UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?', [status, id]);
  }

  async updatePassword(id, passwordHash) {
    await this.db.run('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [passwordHash, id]);
  }
}

module.exports = UserRepository;
