/**
 * Migration 026 — Create round_puzzles junction table.
 *
 * Assigns puzzles to rounds with ordering and scoring configuration.
 * A puzzle can be reused across multiple rounds.
 */

exports.up = (pgm) => {
  pgm.createTable('round_puzzles', {
    id:           { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    round_id:     { type: 'uuid', notNull: true, references: 'rounds(id)', onDelete: 'CASCADE' },
    puzzle_id:    { type: 'uuid', notNull: true, references: 'puzzles(id)' },
    order_number: { type: 'integer', notNull: true },
    score:        { type: 'integer', notNull: true, default: 100 },
  });

  pgm.addConstraint('round_puzzles', 'round_puzzles_round_puzzle_unique', {
    unique: ['round_id', 'puzzle_id'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('round_puzzles');
};
