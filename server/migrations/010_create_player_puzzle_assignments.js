/**
 * Migration 010 — Create player_puzzle_assignments table.
 *
 * Tracks which puzzle each player is working on during a round,
 * including their current grid state and completion status.
 */

exports.up = (pgm) => {
  pgm.createTable('player_puzzle_assignments', {
    id:           { type: 'serial',  primaryKey: true },
    round_id:     { type: 'integer', notNull: true, references: 'rounds(id)' },
    player_id:    { type: 'integer', notNull: true, references: 'users(id)' },
    puzzle_id:    { type: 'integer', notNull: true, references: 'puzzles(id)' },
    team_id:      { type: 'integer', references: 'teams(id)' },
    assigned_at:  { type: 'text',    default: pgm.func('NOW()') },
    current_grid: { type: 'text' },
    is_completed: { type: 'integer', notNull: true, default: 0 },
    completed_at: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('player_puzzle_assignments');
};
