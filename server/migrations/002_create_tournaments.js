/**
 * Migration 002 — Create tournaments table.
 *
 * Top-level tournament entity. Each tournament belongs to a creator (users.id).
 */

exports.up = (pgm) => {
  pgm.createTable('tournaments', {
    id:             { type: 'serial',  primaryKey: true },
    name:           { type: 'text',    notNull: true },
    description:    { type: 'text' },
    status:         { type: 'text',    notNull: true, default: 'PENDING' },
    scheduled_time: { type: 'text' },
    created_by:     { type: 'integer', references: 'users(id)' },
    created_at:     { type: 'text',    default: pgm.func('NOW()') },
    updated_at:     { type: 'text',    default: pgm.func('NOW()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('tournaments');
};
