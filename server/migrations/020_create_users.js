/**
 * Migration 020 — Create users table (UUID version).
 *
 * Redesigned user accounts with UUID primary keys, organization isolation,
 * and role-based access control.
 *
 * Roles: SUPER_ADMIN, ORG_ADMIN, JUDGE, PLAYER
 */

exports.up = (pgm) => {
  pgm.createTable('users', {
    id:              { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    organization_id: { type: 'uuid', references: 'organizations(id)' },
    username:        { type: 'varchar(100)', notNull: true, unique: true },
    password_hash:   { type: 'varchar(255)', notNull: true },
    email:           { type: 'varchar(255)' },
    role:            { type: 'varchar(50)', notNull: true },
    status:          { type: 'varchar(50)', notNull: true, default: 'ACTIVE' },
    created_at:      { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    updated_at:      { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('users', 'organization_id');
  pgm.createIndex('users', 'role');
};

exports.down = (pgm) => {
  pgm.dropTable('users');
};
