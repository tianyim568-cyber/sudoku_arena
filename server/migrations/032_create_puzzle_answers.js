/**
 * Migration 032 — Create puzzle_answers table.
 *
 * Stores each participant's current grid state and progress for each puzzle
 * in a round. Real-time updates via WebSocket during gameplay.
 *
 * progress_percentage: 0.00 to 100.00
 */

exports.up = (pgm) => {
  pgm.createTable('puzzle_answers', {
    id:                  { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    session_id:          { type: 'uuid', notNull: true, references: 'player_round_sessions(id)', onDelete: 'CASCADE' },
    puzzle_id:           { type: 'uuid', notNull: true, references: 'puzzles(id)' },
    current_grid:        { type: 'jsonb', notNull: true },
    correct_cells:       { type: 'integer', notNull: true, default: 0 },
    total_empty_cells:   { type: 'integer', notNull: true, default: 0 },
    progress_percentage: { type: 'decimal(5,2)', notNull: true, default: 0 },
    updated_at:          { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.addConstraint('puzzle_answers', 'puzzle_answers_session_puzzle_unique', {
    unique: ['session_id', 'puzzle_id'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('puzzle_answers');
};
