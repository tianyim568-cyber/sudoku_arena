-- AlterTable
ALTER TABLE "puzzles" ADD COLUMN "grid_hash" VARCHAR(64);

-- CreateIndex
CREATE INDEX "puzzles_org_grid_hash_idx" ON "puzzles"("organization_id", "grid_hash");
