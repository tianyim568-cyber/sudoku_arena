const { z } = require('zod');
const { RoundType } = require('../engine/RoundTypes');
const { DisplayMode } = require('../engine/DisplayModes');

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
  // How long players see the preparation screen before the board opens.
  // Optional: the column defaults to 10s, so an admin who does not care can
  // leave the field alone. Capped at 5 minutes — this is a countdown in front
  // of a waiting room, not an intermission.
  preparationSeconds: z.coerce.number().int().min(0).max(300).optional(),
});

// Zod schema for PUT /api/competitions/:id/stages/:stageId/rounds/:roundId
// (update round — partial). All fields optional, like updateCompetitionSchema.
// roundType is INTENTIONALLY absent: changing the type after puzzles are
// imported would break the engine (rankings are computed per stage category,
// and the round's puzzles were picked for the original type). An admin who
// picked the wrong type must delete and recreate the round.
const updateRoundSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  durationSeconds: z.coerce.number().int().positive().optional(),
  preparationSeconds: z.coerce.number().int().min(0).max(300).optional(),
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

// Zod schema for POST /api/competitions/:id/judges (assign existing judge)
const assignJudgeSchema = z.object({
  judgeId: z.string().uuid(),
});

// Zod schema for POST /api/competitions/:id/judges/create-and-assign
// Admin enters a display name; system auto-generates username + password.
const createAndAssignJudgeSchema = z.object({
  displayName: z.string().min(1).max(100),
});

// Zod schema for PUT /api/competitions/:id/display/mode
const updateDisplayModeSchema = z.object({
  mode: z.enum(Object.values(DisplayMode)),
});

module.exports = {
  createCompetitionSchema,
  createRoundSchema,
  updateRoundSchema,
  updateCompetitionSchema,
  createTeamSchema,
  addTeamMemberSchema,
  assignJudgeSchema,
  createAndAssignJudgeSchema,
  updateDisplayModeSchema,
};
