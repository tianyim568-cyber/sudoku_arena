/**
 * Migration 007 — Create team_members table.
 *
 * Associates users (players) with teams, including their position in the team.
 */

exports.up = (pgm) => {
  pgm.createTable('team_members', {
    id:        { type: 'serial',  primaryKey: true },
    team_id:   { type: 'integer', notNull: true, references: 'teams(id)' },
    player_id: { type: 'integer', notNull: true, references: 'users(id)' },
    position:  { type: 'integer' },
    joined_at: { type: 'text',    default: pgm.func('NOW()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('team_members');
};
