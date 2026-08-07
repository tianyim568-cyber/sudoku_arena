/**
 * Migration 021 — Create competitions table.
 *
 * Top-level competition entity (replaces tournaments). Each competition
 * belongs to an organization and has lifecycle status.
 *
 * Status: DRAFT, PUBLISHED, RUNNING, FINISHED
 */

exports.up = (pgm) => {
  pgm.createTable('competitions', {
    id:              { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    organization_id: { type: 'uuid', notNull: true, references: 'organizations(id)' },
    name:            { type: 'varchar(255)', notNull: true },
    description:     { type: 'text' },
    status:          { type: 'varchar(50)', notNull: true, default: 'DRAFT' },
    access_code:     { type: 'varchar(50)' },
    entry_token:     { type: 'varchar(255)' },
    created_by:      { type: 'uuid', references: 'users(id)' },
    created_at:      { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:      { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('competitions', 'organization_id');
  pgm.createIndex('competitions', 'access_code');

  pgm.addConstraint('competitions', 'competitions_org_access_code_unique', {
    unique: ['organization_id', 'access_code'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('competitions');
};
