/**
 * Migration 050 — Add unique constraint on (competition_id, name) in teams table.
 *
 * Prevents duplicate team names within the same competition. The Excel import
 * de-duplicates teams via an in-memory cache, but concurrent imports or manual
 * team creation could bypass that. This DB-level constraint catches the race
 * condition and fails with a unique constraint violation (Prisma P2002).
 */

exports.up = (pgm) => {
  pgm.createIndex('teams', ['competition_id', 'name'], {
    unique: true,
    name: 'teams_competition_id_name_unique',
  });

  pgm.sql(`COMMENT ON INDEX teams_competition_id_name_unique IS 'Prevents duplicate team names within the same competition'`);
};

exports.down = (pgm) => {
  pgm.dropIndex('teams', ['competition_id', 'name'], {
    name: 'teams_competition_id_name_unique',
  });
};
