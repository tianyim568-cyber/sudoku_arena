/**
 * Migration 006 — Create puzzle_relations table.
 *
 * Links related puzzles (e.g., parent/child relationships within a round).
 */

exports.up = (pgm) => {
  pgm.createTable('puzzle_relations', {
    id:                { type: 'serial',  primaryKey: true },
    puzzle_id:         { type: 'integer', notNull: true, references: 'puzzles(id)' },
    related_puzzle_id: { type: 'integer', notNull: true, references: 'puzzles(id)' },
    relation_type:     { type: 'text',    notNull: true },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('puzzle_relations');
};
