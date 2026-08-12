/**
 * Migration 023 — Create rounds table (UUID version).
 *
 * Each round belongs to a stage (not directly to a competition).
 * Rounds have lifecycle status and timing information.
 *
 * Status: WAITING, RUNNING, FINISHED
 * Type: STANDARD, TEAM_STANDARD, SPECIAL
 */

exports.up = (pgm) => {
  pgm.createTable('rounds', {
    id:               { type: 'uuid', primaryKey: true, default: pgm.func('uuid_generate_v4()') },
    stage_id:         { type: 'uuid', notNull: true, references: 'competition_stages(id)', onDelete: 'CASCADE' },
    name:             { type: 'varchar(255)', notNull: true },
    type:             { type: 'varchar(50)', notNull: true },
    order_number:     { type: 'integer', notNull: true },
    duration_seconds: { type: 'integer', notNull: true },
    waiting_seconds:  { type: 'integer', notNull: true, default: 0 },
    status:           { type: 'varchar(50)', notNull: true, default: 'WAITING' },
    started_at:       { type: 'timestamptz' },
    ended_at:         { type: 'timestamptz' },
    created_at:       { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.createIndex('rounds', 'stage_id');
};

exports.down = (pgm) => {
  pgm.dropTable('rounds');
};
