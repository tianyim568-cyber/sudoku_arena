/**
 * Migration 042: Rename participants → players, remove group_name and category, add category_id FK
 */

exports.up = (pgm) => {
  // Drop indexes that reference the old table name
  pgm.dropIndex('participants', 'competition_id');
  pgm.dropIndex('participants', 'category');
  // Drop FK constraints
  pgm.dropConstraint('participants', 'participants_competition_id_fkey');
  pgm.dropConstraint('participants', 'participants_user_id_fkey');
  // Rename table
  pgm.renameTable('participants', 'players');
  // Drop columns using raw SQL to avoid API issues
  pgm.sql('ALTER TABLE players DROP COLUMN IF EXISTS group_name');
  pgm.sql('ALTER TABLE players DROP COLUMN IF EXISTS category');
  // Add category_id FK
  pgm.addColumn('players', {
    category_id: {
      type: 'uuid',
      notNull: false,
      references: 'categories(id)',
    },
  });
  // Re-add FKs with new table name
  pgm.addConstraint('players', 'players_competition_id_fkey', {
    foreignKeys: {
      columns: 'competition_id',
      references: 'competitions(id)',
    },
  });
  pgm.addConstraint('players', 'players_user_id_fkey', {
    foreignKeys: {
      columns: 'user_id',
      references: 'users(id)',
    },
  });
  // Recreate indexes
  pgm.createIndex('players', 'competition_id');
  pgm.createIndex('players', 'category_id');
};

exports.down = (pgm) => {
  pgm.dropIndex('players', 'competition_id');
  pgm.dropIndex('players', 'category_id');
  pgm.dropConstraint('players', 'players_competition_id_fkey');
  pgm.dropConstraint('players', 'players_user_id_fkey');
  pgm.dropColumn('players', 'category_id');
  pgm.addColumn('players', {
    category: {
      type: 'varchar(50)',
      notNull: false,
    },
  });
  pgm.addColumn('players', {
    group_name: {
      type: 'varchar(100)',
      notNull: false,
    },
  });
  pgm.renameTable('players', 'participants');
  pgm.addConstraint('participants', 'participants_competition_id_fkey', {
    foreignKeys: {
      columns: 'competition_id',
      references: 'competitions(id)',
    },
  });
  pgm.addConstraint('participants', 'participants_user_id_fkey', {
    foreignKeys: {
      columns: 'user_id',
      references: 'users(id)',
    },
  });
  pgm.createIndex('participants', 'competition_id');
  pgm.createIndex('participants', 'category');
};
