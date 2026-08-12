/**
 * Migration 043: Add category_id FK to puzzles, round_puzzles, round_rankings
 */

exports.up = (pgm) => {
  pgm.addColumn('puzzles', {
    category_id: {
      type: 'uuid',
      notNull: false,
      references: 'categories(id)',
    },
  });
  pgm.createIndex('puzzles', 'category_id');

  pgm.addColumn('round_puzzles', {
    category_id: {
      type: 'uuid',
      notNull: false,
      references: 'categories(id)',
    },
  });
  pgm.createIndex('round_puzzles', 'category_id');

  pgm.addColumn('round_rankings', {
    category_id: {
      type: 'uuid',
      notNull: false,
      references: 'categories(id)',
    },
  });
  pgm.createIndex('round_rankings', 'category_id');
};

exports.down = (pgm) => {
  pgm.dropIndex('round_rankings', 'category_id');
  pgm.dropColumn('round_rankings', 'category_id');
  pgm.dropIndex('round_puzzles', 'category_id');
  pgm.dropColumn('round_puzzles', 'category_id');
  pgm.dropIndex('puzzles', 'category_id');
  pgm.dropColumn('puzzles', 'category_id');
};
