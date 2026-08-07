/**
 * Migration 044: Recreate final_rankings with new schema
 * - Drop old final_rankings table
 * - Create new table with competition_stage_id, category_id, entity_type (ENUM), entity_id
 */

exports.up = (pgm) => {
  // Create ENUM type
  pgm.createType('entity_type', ['PLAYER', 'TEAM']);
  // Drop old table
  pgm.dropTable('final_rankings');
  // Create new table
  pgm.createTable('final_rankings', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    competition_stage_id: {
      type: 'uuid',
      notNull: true,
      references: 'competition_stages(id)',
    },
    category_id: {
      type: 'uuid',
      notNull: true,
      references: 'categories(id)',
    },
    entity_type: {
      type: 'entity_type',
      notNull: true,
    },
    entity_id: {
      type: 'uuid',
      notNull: true,
    },
    rank: {
      type: 'integer',
      notNull: true,
    },
    score: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.createIndex('final_rankings', 'competition_stage_id');
  pgm.createIndex('final_rankings', 'category_id');
};

exports.down = (pgm) => {
  pgm.dropTable('final_rankings');
  pgm.dropType('entity_type');
  // Recreate old schema
  pgm.createTable('final_rankings', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('uuid_generate_v4()'),
    },
    competition_id: {
      type: 'uuid',
      notNull: true,
      references: 'competitions(id)',
    },
    category: {
      type: 'varchar(50)',
      notNull: false,
    },
    competition_type: {
      type: 'varchar(50)',
      notNull: true,
    },
    entity_id: {
      type: 'uuid',
      notNull: true,
    },
    rank: {
      type: 'integer',
      notNull: true,
    },
    score: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });
  pgm.createIndex('final_rankings', 'competition_id');
};
