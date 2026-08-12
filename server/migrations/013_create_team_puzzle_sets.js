/**
 * Migration 013 — Create team_puzzle_sets table.
 *
 * Round 1: tracks which set of puzzles (by word/letter) is assigned to each team.
 * Has a UNIQUE constraint on (round_id, team_id).
 */

exports.up = (pgm) => {
  pgm.createTable('team_puzzle_sets', {
    id:            { type: 'serial',  primaryKey: true },
    tournament_id: { type: 'integer', notNull: true, references: 'tournaments(id)' },
    round_id:      { type: 'integer', notNull: true, references: 'rounds(id)' },
    team_id:       { type: 'integer', notNull: true, references: 'teams(id)' },
    word:          { type: 'text',    notNull: true },
    puzzle_ids:    { type: 'text',    notNull: true },
    assigned_at:   { type: 'text',    default: pgm.func('NOW()') },
  });

  pgm.addConstraint('team_puzzle_sets', 'team_puzzle_sets_round_team_unique', {
    unique: ['round_id', 'team_id'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('team_puzzle_sets');
};
