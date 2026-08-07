/**
 * Migration 029 — Create teams table (UUID version).
 *
 * Teams belong to a competition. Team members are added in the next migration.
 */

exports.up = (pgm) => {
  pgm.createTable('teams', {
    id:             { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    competition_id: { type: 'uuid', notNull: true, references: 'competitions(id)', onDelete: 'CASCADE' },
    name:           { type: 'varchar(255)', notNull: true },
    created_at:     { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('teams');
};
