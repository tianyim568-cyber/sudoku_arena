/**
 * Migration 003 — Create rounds table.
 *
 * Each round belongs to a tournament and has a type (round1/round2/round3)
 * and lifecycle status.
 */

exports.up = (pgm) => {
  pgm.createTable('rounds', {
    id:                { type: 'serial',  primaryKey: true },
    tournament_id:     { type: 'integer', notNull: true, references: 'tournaments(id)' },
    round_number:      { type: 'integer', notNull: true },
    name:              { type: 'text',    notNull: true },
    round_type:        { type: 'text',    notNull: true },
    duration_seconds:  { type: 'integer', notNull: true },
    status:            { type: 'text',    notNull: true, default: 'NOT_STARTED' },
    remaining_seconds: { type: 'integer' },
    started_at:        { type: 'text' },
    ended_at:          { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('rounds');
};
