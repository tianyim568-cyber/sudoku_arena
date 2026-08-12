/**
 * Migration 005 — Create puzzles table.
 *
 * Each puzzle belongs to a round and optionally to a team (for round 1 assignments).
 * Stores the initial grid, solution, points, and metadata as serialized JSON strings.
 */

exports.up = (pgm) => {
  pgm.createTable('puzzles', {
    id:            { type: 'serial',  primaryKey: true },
    round_id:      { type: 'integer', notNull: true, references: 'rounds(id)' },
    puzzle_type:   { type: 'text',    notNull: true },
    order_in_round:{ type: 'integer', notNull: true },
    initial_grid:  { type: 'text',    notNull: true },
    solution:      { type: 'text',    notNull: true },
    points:        { type: 'integer', notNull: true, default: 100 },
    letter:        { type: 'text' },
    metadata:      { type: 'text' },
    difficulty:    { type: 'text' },
    team_id:       { type: 'integer', references: 'teams(id)' },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('puzzles');
};
