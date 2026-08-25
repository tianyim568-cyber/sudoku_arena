/**
 * Migration 051 — Add organization_id and round_type to puzzles table.
 *
 * Tenant isolation: every puzzle now carries its owning organization_id so
 * queries can filter by org without joining through rounds→competitions.
 *
 * round_type stores the round type string (ROUND1_NINE_ONE, ROUND2_RELAY,
 * ROUND3_COLLABORATE) so the puzzle bank can filter by type without joining
 * through round_puzzles→rounds.
 *
 * Both columns are nullable so existing rows survive the migration. New writes
 * always stamp these values.
 *
 * Foreign key: puzzles.organization_id → organizations(id), ON DELETE SET NULL.
 * If an org is deleted, its puzzles become orphaned rather than cascading away.
 */

exports.up = (pgm) => {
  // Add columns (IF NOT EXISTS for idempotency)
  pgm.sql(`
    ALTER TABLE puzzles
    ADD COLUMN IF NOT EXISTS organization_id UUID,
    ADD COLUMN IF NOT EXISTS round_type VARCHAR(50)
  `);

  // Create indices
  pgm.createIndex('puzzles', 'organization_id', {
    name: 'puzzles_organization_id_index',
  });

  pgm.createIndex('puzzles', 'round_type', {
    name: 'puzzles_round_type_index',
  });

  // Foreign key: organization_id → organizations(id), ON DELETE SET NULL
  pgm.sql(`
    ALTER TABLE puzzles
    DROP CONSTRAINT IF EXISTS puzzles_organization_id_fkey
  `);

  pgm.sql(`
    ALTER TABLE puzzles
    ADD CONSTRAINT puzzles_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES organizations(id)
    ON DELETE SET NULL
    ON UPDATE NO ACTION
  `);
};

exports.down = (pgm) => {
  // Drop foreign key
  pgm.sql(`
    ALTER TABLE puzzles
    DROP CONSTRAINT IF EXISTS puzzles_organization_id_fkey
  `);

  // Drop indices
  pgm.dropIndex('puzzles', 'organization_id', {
    name: 'puzzles_organization_id_index',
  });

  pgm.dropIndex('puzzles', 'round_type', {
    name: 'puzzles_round_type_index',
  });

  // Drop columns
  pgm.dropColumns('puzzles', ['organization_id', 'round_type']);
};
