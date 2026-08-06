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

// Zod schema for PUT /api/tournaments/:id (update tournament — partial)
const updateTournamentSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  scheduledTime: z.string().nullish(),
});

// Zod schema for POST /api/tournaments/:id/teams (create team)
const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
});

// Zod schema for POST /api/teams/:teamId/members (add team member)
const addTeamMemberSchema = z.object({
  playerId: z.coerce.number().int().positive(),
  position: z.coerce.number().int().optional(),
});

// Zod schema for POST /api/tournaments/:id/judges (assign judge)
const assignJudgeSchema = z.object({
  judgeId: z.coerce.number().int().positive(),
});

module.exports = {
  createTournamentSchema,
  createRoundSchema,
  updateTournamentSchema,
  createTeamSchema,
  addTeamMemberSchema,
  assignJudgeSchema,
};
