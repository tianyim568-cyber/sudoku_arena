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

module.exports = { generatePuzzlesSchema, generateBulkSchema, importToRoundSchema };
