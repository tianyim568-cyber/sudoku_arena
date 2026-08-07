/**
 * CategoryRepository — abstracts category-related database operations.
 * Works with the `categories` table (created in migration 037).
 *
 * Schema:
 *   - id (uuid PK)
 *   - name (varchar UNIQUE) - e.g., 'U6', 'U8', 'U12'
 *   - min_age (integer)
 *   - max_age (integer)
 *   - created_at (timestamptz)
 */

class CategoryRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Find category by ID.
   * @param {string} id - Category UUID
   * @returns {Promise<object|null>}
   */
  async findById(id) {
    return this.db.get('SELECT * FROM categories WHERE id = ?', [id]);
  }

  /**
   * Find category by name.
   * @param {string} name - Category name (e.g., 'U6', 'U8', 'U12')
   * @returns {Promise<object|null>}
   */
  async findByName(name) {
    return this.db.get('SELECT * FROM categories WHERE name = ?', [name]);
  }

  /**
   * Find all categories.
   * @returns {Promise<object[]>}
   */
  async findAll() {
    return this.db.all('SELECT * FROM categories ORDER BY min_age, max_age');
  }

  /**
   * Find category that matches a given age.
   * @param {number} age - Player age
   * @returns {Promise<object|null>}
   */
  async findByAge(age) {
    return this.db.get(
      'SELECT * FROM categories WHERE ? >= min_age AND ? <= max_age',
      [age, age]
    );
  }

  /**
   * Create a new category.
   * @param {object} categoryData
   * @param {string} categoryData.name - Category name (e.g., 'U10')
   * @param {number} categoryData.minAge - Minimum age
   * @param {number} categoryData.maxAge - Maximum age
   * @returns {Promise<object>} Created category
   */
  async create(categoryData) {
    await this.db.run(
      'INSERT INTO categories (name, min_age, max_age) VALUES (?, ?, ?)',
      [categoryData.name, categoryData.minAge, categoryData.maxAge]
    );
    return this.db.get('SELECT * FROM categories WHERE name = ?', [categoryData.name]);
  }

  /**
   * Update a category.
   * @param {string} id - Category UUID
   * @param {object} updates - Fields to update
   * @returns {Promise<object>} Updated category
   */
  async update(id, updates) {
    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.minAge !== undefined) {
      fields.push('min_age = ?');
      values.push(updates.minAge);
    }
    if (updates.maxAge !== undefined) {
      fields.push('max_age = ?');
      values.push(updates.maxAge);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    await this.db.run(
      `UPDATE categories SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
    return this.findById(id);
  }

  /**
   * Delete a category by ID.
   * @param {string} id - Category UUID
   * @returns {Promise<void>}
   */
  async delete(id) {
    await this.db.run('DELETE FROM categories WHERE id = ?', [id]);
  }

  /**
   * Count players in a category.
   * @param {string} categoryId - Category UUID
   * @returns {Promise<number>}
   */
  async countPlayers(categoryId) {
    const result = await this.db.get(
      'SELECT COUNT(*) as count FROM players WHERE category_id = ?',
      [categoryId]
    );
    return parseInt(result.count, 10);
  }
}

module.exports = CategoryRepository;
