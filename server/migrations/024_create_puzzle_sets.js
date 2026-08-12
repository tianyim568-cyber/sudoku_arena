/**
 * Migration 024 — Create puzzle_sets table.
 *
 * Collections of puzzles (e.g., imported from PDF, manually created).
 * Each puzzle_set belongs to an organization.
 *
 * Source: pdf_import, manual, generated
 */

exports.up = (pgm) => {
  pgm.createTable('puzzle_sets', {
    id:              { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations(id)' },
    name:            { type: 'varchar(255)', notNull: true },
    source:          { type: 'varchar(100)' },
    created_at:      { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('puzzle_sets', 'organization_id');
};

exports.down = (pgm) => {
  pgm.dropTable('puzzle_sets');
};
