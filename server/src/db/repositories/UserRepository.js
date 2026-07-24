/**
 * User repository — abstracts all user-related database operations.
 * All methods are async (PostgreSQL).
 */

class UserRepository {
  /**
   * @param {{ run: Function, all: Function, get: Function }} db
   */
  constructor(db) {
    this.db = db;
  }

  async findById(id) {
    return this.db.get('SELECT id, username, role, display_name, created_at FROM users WHERE id = ?', [id]);
  }

  async findByUsername(username) {
    return this.db.get('SELECT * FROM users WHERE username = ?', [username]);
  }

  async findByUsernameSafe(username) {
    return this.db.get('SELECT id, username, role, display_name FROM users WHERE username = ?', [username]);
  }

  async findAll() {
    return this.db.all('SELECT id, username, role, display_name, created_at FROM users ORDER BY id');
  }

  async findByRole(role) {
    return this.db.all('SELECT * FROM users WHERE role = ?', [role]);
  }

  async create({ username, password, role, displayName }) {
    await this.db.run(
      'INSERT INTO users (username, password, role, display_name) VALUES (?, ?, ?, ?)',
      [username, password, role, displayName || username]
    );
    return this.db.get('SELECT id, username, role, display_name FROM users WHERE username = ?', [username]);
  }

  async getDisplayName(userId) {
    const row = await this.db.get('SELECT display_name FROM users WHERE id = ?', [userId]);
    return row?.display_name || '';
  }
}

module.exports = UserRepository;
