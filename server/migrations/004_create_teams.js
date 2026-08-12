/**
 * Migration 004 — Create teams table.
 *
 * Teams belong to a tournament. Team members are added in a later migration.
 */

exports.up = (pgm) => {
  pgm.createTable('teams', {
    id:            { type: 'serial',  primaryKey: true },
    tournament_id: { type: 'integer', notNull: true, references: 'tournaments(id)' },
    name:          { type: 'text',    notNull: true },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('teams');
};
