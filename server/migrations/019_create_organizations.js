/**
 * Migration 019 — Create organizations table.
 *
 * Core multi-tenant root table. All other tables reference organizations
 * either directly or through FK chains.
 */

exports.up = (pgm) => {
  pgm.createTable('organizations', {
    id:          { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    name:        { type: 'varchar(255)', notNull: true },
    description: { type: 'text' },
    status:      { type: 'varchar(50)', notNull: true, default: 'ACTIVE' },
    created_at:  { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:  { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('organizations');
};
