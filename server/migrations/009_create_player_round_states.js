/**
 * Migration 009 — Create player_round_states table.
 *
 * Tracks each player's state within a round (e.g., WAITING, ACTIVE).
 */

exports.up = (pgm) => {
  pgm.createTable('player_round_states', {
    id:        { type: 'serial',  primaryKey: true },
    round_id:  { type: 'integer', notNull: true, references: 'rounds(id)' },
    player_id: { type: 'integer', notNull: true, references: 'users(id)' },
    team_id:   { type: 'integer', references: 'teams(id)' },
    status:    { type: 'text',    notNull: true, default: 'WAITING' },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('player_round_states');
};
