/**
 * Migration 008 — Create tournament_judges table.
 *
 * Assigns judge users to tournaments.
 */

exports.up = (pgm) => {
  pgm.createTable('tournament_judges', {
    id:            { type: 'serial',  primaryKey: true },
    tournament_id: { type: 'integer', notNull: true, references: 'tournaments(id)' },
    judge_id:      { type: 'integer', notNull: true, references: 'users(id)' },
    assigned_at:   { type: 'text',    default: pgm.func('NOW()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('tournament_judges');
};
