/**
 * Migration 022 — Create competition_stages table.
 *
 * Stage-aware competition lifecycle. Each competition has one or more stages
 * (INDIVIDUAL, TEAM, PK) executed in order.
 *
 * Status: WAITING, RUNNING, FINISHED
 */

exports.up = (pgm) => {
  pgm.createTable('competition_stages', {
    id:             { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    competition_id: { type: 'uuid', notNull: true, references: 'competitions(id)', onDelete: 'CASCADE' },
    type:           { type: 'varchar(50)', notNull: true },
    order_number:   { type: 'integer', notNull: true },
    status:         { type: 'varchar(50)', notNull: true, default: 'WAITING' },
    created_at:     { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.addConstraint('competition_stages', 'competition_stages_competition_order_unique', {
    unique: ['competition_id', 'order_number'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('competition_stages');
};
