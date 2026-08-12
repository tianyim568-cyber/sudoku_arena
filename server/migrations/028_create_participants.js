/**
 * Migration 028 — Create participants table (UUID version).
 *
 * Individual competitors with optional user account link.
 * Participants belong directly to a competition (not through a junction table).
 *
 * Category: U6, U8, U12, OPEN
 */

exports.up = (pgm) => {
  pgm.createTable('participants', {
    id:             { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    competition_id: { type: 'uuid', notNull: true, references: 'competitions(id)', onDelete: 'CASCADE' },
    user_id:        { type: 'uuid', references: 'users(id)' },
    name:           { type: 'varchar(255)', notNull: true },
    school:         { type: 'varchar(255)' },
    province:       { type: 'varchar(100)' },
    age:            { type: 'integer' },
    category:       { type: 'varchar(50)' },
    group_name:     { type: 'varchar(100)' },
    created_at:     { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('participants', 'competition_id');
  pgm.createIndex('participants', 'category');
};

exports.down = (pgm) => {
  pgm.dropTable('participants');
};
