const { z } = require('zod');

// Zod schema for POST /api/tournaments (create tournament)
const createTournamentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

// Zod schema for POST /api/tournaments/:id/rounds (create round)
const createRoundSchema = z.object({
  name: z.string().min(1).max(100),
  roundType: z.enum(['ROUND1_NINE_ONE', 'ROUND2_RELAY', 'ROUND3_COLLABORATE']),
  durationSeconds: z.coerce.number().int().positive(),
});

module.exports = { createTournamentSchema, createRoundSchema };
