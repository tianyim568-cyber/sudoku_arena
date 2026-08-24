-- Migration 050 — unique constraint on (competition_id, name) in teams.
--
-- Louise/POINTS_POUR_SYLVAIN §11: today the Excel import de-duplicates
-- teams via an in-memory cache. Fine for a single import, but if two
-- imports run at the same time on the same competition (or a manual
-- team creation collides with an import) two teams with the same name
-- can land — and everything downstream that keys on (competition_id,
-- name) gets ambiguous.
--
-- The DB-level unique index closes that race. Any duplicate insert now
-- fails with a Prisma P2002 (unique constraint violation) which the
-- application layer already handles for team creation.
--
-- Idempotence: `IF NOT EXISTS` so a re-apply is safe on an already-
-- migrated database.

CREATE UNIQUE INDEX IF NOT EXISTS "teams_competition_id_name_unique"
  ON "teams" ("competition_id", "name");
