/**
 * Migration 041: Drop puzzle_sets table and remove puzzles.puzzle_set_id
 */

exports.up = (pgm) => {
  // Drop the FK on puzzles.puzzle_set_id first
  pgm.dropConstraint('puzzles', 'puzzles_puzzle_set_id_fkey');
  pgm.dropIndex('puzzles', 'puzzle_set_id');
  pgm.dropColumn('puzzles', 'puzzle_set_id');
  // Drop puzzle_sets table
  pgm.dropTable('puzzle_sets');
};

exports.down = (pgm) => {
  pgm.createTable('puzzle_sets', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    organization_id: {
      type: 'uuid',
      notNull: true,
      references: 'organizations(id)',
    },
    name: {
      type: 'varchar(255)',
      notNull: true,
    },
    source: {
      type: 'varchar(100)',
      notNull: false,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.createIndex('puzzle_sets', 'organization_id');
  pgm.addColumn('puzzles', {
    puzzle_set_id: {
      type: 'uuid',
      notNull: false,
      references: 'puzzle_sets(id)',
    },
  });
  pgm.createIndex('puzzles', 'puzzle_set_id');
};
