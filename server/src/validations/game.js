const { z } = require('zod');

const id = z.string().uuid();
const cellIndex = z.coerce.number().int().min(0).max(8);
const cellValue = z.coerce.number().int().min(0).max(9);
const gridSchema = z.array(z.array(cellValue).length(9)).length(9);

// Zod schema for POST /api/game/submissions
const submitAnswerSchema = z.discriminatedUnion('submissionType', [
  z.object({
    submissionType: z.literal('SINGLE_CELL'),
    roundId: id,
    puzzleId: id,
    row: cellIndex,
    col: cellIndex,
    value: cellValue,
  }),
  z.object({
    submissionType: z.literal('FULL_GRID'),
    roundId: id,
    puzzleId: id,
    grid: gridSchema,
  }),
]);

module.exports = { submitAnswerSchema };
