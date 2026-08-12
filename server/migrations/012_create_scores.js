/**
 * Migration 012 — Create scores table.
 *
 * Aggregated scores per player/team per round within a tournament.
 */

exports.up = (pgm) => {
  pgm.createTable('scores', {
    id:            { type: 'serial',  primaryKey: true },
    tournament_id: { type: 'integer', notNull: true, references: 'tournaments(id)' },
    round_id:      { type: 'integer', notNull: true, references: 'rounds(id)' },
    player_id:     { type: 'integer', references: 'users(id)' },
    team_id:       { type: 'integer', references: 'teams(id)' },
    score_type:    { type: 'text',    notNull: true },
    total_points:  { type: 'integer', notNull: true, default: 0 },
    updated_at:    { type: 'text',    default: pgm.func('NOW()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('scores');
};
