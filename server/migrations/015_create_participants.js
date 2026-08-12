/**
 * Migration 015 — Create participants table.
 *
 * Participant import: individual competitors with optional user account link,
 * school affiliation, and login credentials.
 *
 * The `account` and `password` columns are included here directly (they were
 * originally added via ALTER TABLE in the old schema, but for a fresh migration
 * they belong in the initial table definition).
 */

exports.up = (pgm) => {
  pgm.createTable('participants', {
    id:         { type: 'serial',  primaryKey: true },
    user_id:    { type: 'integer', references: 'users(id)' },
    name:       { type: 'text',    notNull: true },
    age:        { type: 'integer' },
    category:   { type: 'text' },
    school_id:  { type: 'integer', references: 'schools(id)' },
    account:    { type: 'text' },
    password:   { type: 'text' },
    created_at: { type: 'text',    default: pgm.func('NOW()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('participants');
};
