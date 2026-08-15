const { z } = require('zod');
const { RoundType } = require('../engine/RoundTypes');

// Zod schema for POST /api/competitions (create competition)
const createCompetitionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

// Zod schema for creating a round.
//
// The accepted types are read from RoundTypes.js rather than listed here, so
// the validator cannot drift from the engine. It used to hardcode the three
// TEAM types, which silently made INDIVIDUAL stages unusable: their rounds
// were rejected before reaching any handler.
//
// This only checks that the type EXISTS. Whether it suits the stage it is
// being added to (a team round in an individual stage) is decided by the
// route, which knows the stage.
const createRoundSchema = z.object({
  name: z.string().min(1).max(100),
  roundType: z.enum(Object.values(RoundType)),
  durationSeconds: z.coerce.number().int().positive(),
});

// Zod schema for PUT /api/competitions/:id (update competition — partial)
const updateCompetitionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  scheduledTime: z.string().nullish(),
});

// Zod schema for POST /api/competitions/:id/teams (create team)
const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
});

// Zod schema for POST /api/teams/:teamId/members (add team member)
const addTeamMemberSchema = z.object({
  playerId: z.string().uuid(),
  position: z.coerce.number().int().optional(),
});

// Zod schema for POST /api/competitions/:id/judges (assign judge)
const assignJudgeSchema = z.object({
  judgeId: z.string().uuid(),
});

module.exports = {
  createCompetitionSchema,
  createRoundSchema,
  updateCompetitionSchema,
  createTeamSchema,
  addTeamMemberSchema,
  assignJudgeSchema,
};
