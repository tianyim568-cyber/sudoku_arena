/**
 * Migration 037: Create categories table
 * Defines age-based competition categories (U6, U8, U12)
 */

exports.up = (pgm) => {
  pgm.createTable('categories', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    name: {
      type: 'varchar(50)',
      notNull: true,
      unique: true,
    },
    min_age: {
      type: 'integer',
      notNull: true,
    },
    max_age: {
      type: 'integer',
      notNull: true,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Seed default categories
  pgm.sql(`
    INSERT INTO categories (name, min_age, max_age) VALUES
      ('U6', 6, 7),
      ('U8', 8, 9),
      ('U12', 10, 12)
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('categories');
};
