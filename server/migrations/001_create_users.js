/**
 * Migration 001 — Create users table.
 *
 * Stores admin, judge, and player accounts.
 * The seed users (admin, judge, player1–player8) are created in a separate
 * seeding migration (017_seed_users.js) so that schema and data are decoupled.
 */

exports.up = (pgm) => {
  pgm.createTable('users', {
    id:           { type: 'serial',  primaryKey: true },
    username:     { type: 'text',    notNull: true, unique: true },
    password:     { type: 'text',    notNull: true },
    role:         { type: 'text',    notNull: true },
    display_name: { type: 'text' },
    created_at:   { type: 'text',    default: pgm.func('NOW()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('users');
};
