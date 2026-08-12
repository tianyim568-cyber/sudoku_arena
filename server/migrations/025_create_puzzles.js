/**
 * Migration 025 — Create puzzles table (UUID version).
 *
 * Individual puzzles with JSONB grids for efficient querying and updates.
 * Each puzzle belongs to a puzzle_set.
 *
 * Type: STANDARD, JOC, FINAL (extensible)
 */

exports.up = (pgm) => {
  pgm.createTable('puzzles', {
    id:            { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    puzzle_set_id: { type: 'uuid', notNull: true, references: 'puzzle_sets(id)' },
    type:          { type: 'varchar(100)' },
    initial_grid:  { type: 'jsonb', notNull: true },
    solution_grid: { type: 'jsonb', notNull: true },
    difficulty:    { type: 'varchar(50)' },
    score:         { type: 'integer', notNull: true, default: 100 },
    created_at:    { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('puzzles', 'puzzle_set_id');
};

exports.down = (pgm) => {
  pgm.dropTable('puzzles');
};
