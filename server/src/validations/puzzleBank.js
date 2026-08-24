const { z } = require('zod');

const id = z.string().uuid();

// Zod schema for POST /api/puzzle-bank/generate
const generatePuzzlesSchema = z.object({
  roundType: z.enum(['ROUND1_NINE_ONE', 'ROUND2_RELAY', 'ROUND3_COLLABORATE', 'INDIVIDUAL_STANDARD']),
  count: z.coerce.number().int().positive().optional(),
  teamsCount: z.coerce.number().int().positive().optional(),
});

// Zod schema for POST /api/puzzle-bank/generate-bulk
const generateBulkSchema = z.object({
  teamsCount: z.coerce.number().int().positive(),
});

// Zod schema for POST /api/puzzle-bank/import-to-round
const importToRoundSchema = z.object({
  roundId: id,
  puzzleIds: z.array(z.string()).optional(),
  count: z.coerce.number().int().positive().optional(),
  teamsCount: z.coerce.number().int().positive().optional(),
});

// Zod schema for POST /api/puzzle-bank/import-pdf/confirm.
// `roundId` is REQUIRED — every batch of PDF puzzles must land inside a
// specific round. There is no "generic pool" any more: this rule (2026-08-24
// product decision) means the puzzles you upload for round R belong to R and
// nowhere else. The route verifies the round exists AND belongs to the
// caller's org before writing anything.
const pdfConfirmSchema = z.object({
  roundId: id,
});

module.exports = { generatePuzzlesSchema, generateBulkSchema, importToRoundSchema, pdfConfirmSchema };
