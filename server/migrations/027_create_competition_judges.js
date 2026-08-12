/**
 * Migration 027 — Create competition_judges junction table.
 *
 * Assigns judge users to competitions. Composite primary key ensures
 * a judge can only be assigned once per competition.
 */

exports.up = (pgm) => {
  pgm.createTable('competition_judges', {
    competition_id: { type: 'uuid', notNull: true, references: 'competitions(id)', onDelete: 'CASCADE' },
    user_id:        { type: 'uuid', notNull: true, references: 'users(id)', onDelete: 'CASCADE' },
    assigned_at:    { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
  });

  pgm.addConstraint('competition_judges', 'competition_judges_pkey', {
    primaryKey: ['competition_id', 'user_id'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('competition_judges');
};
