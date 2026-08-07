/**
 * Migration 034 — Create final_rankings table.
 *
 * Competition-wide rankings after all rounds complete. Supports multiple
 * ranking types (INDIVIDUAL, TEAM, PK) and category-based filtering.
 *
 * entity_id: participant_id or team_id depending on competition_type
 * category: U6, U8, U12, OPEN (nullable for overall ranking)
 */

exports.up = (pgm) => {
  pgm.createTable('final_rankings', {
    id:               { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    competition_id:   { type: 'uuid', notNull: true, references: 'competitions(id)', onDelete: 'CASCADE' },
    category:         { type: 'varchar(50)' },
    competition_type: { type: 'varchar(50)', notNull: true },
    entity_id:        { type: 'uuid', notNull: true },
    rank:             { type: 'integer', notNull: true },
    score:            { type: 'integer', notNull: true, default: 0 },
    created_at:       { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('final_rankings', 'competition_id');
};

exports.down = (pgm) => {
  pgm.dropTable('final_rankings');
};
