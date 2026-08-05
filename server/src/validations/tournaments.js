const { z } = require('zod');

// Zod schema for POST /api/tournaments (create tournament)
const createTournamentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

module.exports = { createTournamentSchema };
