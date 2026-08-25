-- Migration 051 — add organization_id to puzzles (ISSUE-25).
--
-- Before this migration, puzzle-bank.json served as a flat cache between
-- puzzle generation and the `puzzles` table. The file grew unbounded
-- (every generate pushed, nothing trimmed), puzzle IDs were built from
-- array length (`R1-${bank.puzzles.length + 1}`) which collided after
-- deletions, and writes had no concurrency control. The 2026-08-24
-- product decision already killed the "generic pool" concept — every
-- PDF batch is tied to a specific round. The last remnant of the pool
-- (auto-generation) now writes directly to the `puzzles` table.
--
-- To keep tenant isolation at the DB level, puzzles carry their owning
-- `organization_id`. The column is nullable so existing rows survive
-- the migration; new writes always stamp it (caller-supplied, never
-- user-supplied — see PuzzleBankService.generatePuzzles).
--
-- Idempotence: `IF NOT EXISTS` so a re-apply is safe on an already-
-- migrated database.

ALTER TABLE "puzzles"
  ADD COLUMN IF NOT EXISTS "organization_id" UUID;

ALTER TABLE "puzzles"
  ADD COLUMN IF NOT EXISTS "round_type" VARCHAR(50);

CREATE INDEX IF NOT EXISTS "puzzles_organization_id_index"
  ON "puzzles" ("organization_id");

CREATE INDEX IF NOT EXISTS "puzzles_round_type_index"
  ON "puzzles" ("round_type");

-- Foreign key: a puzzle belongs to exactly one organization. SET NULL
-- on delete is the safe default — if an org is ever deleted, its
-- puzzles become orphaned rather than cascading away. The Prisma
-- schema mirrors this with onDelete: NoAction, which is the default.
ALTER TABLE "puzzles"
  DROP CONSTRAINT IF EXISTS "puzzles_organization_id_fkey";
ALTER TABLE "puzzles"
  ADD CONSTRAINT "puzzles_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
