const { z } = require('zod');

// Zod schemas for incoming WebSocket (Socket.IO) messages.
//
// Only the format-agnostic "core" messages are validated here for now
// (join_room, leave_room, cell_fill, answer_submit) — these survive any
// competition restructuring. The round2/round3 format-specific messages are
// intentionally DEFERRED until the individual/team/PK restructuring clarifies
// their shape (see project notes / KNOWN_ISSUES).

// Reusable field rules — mirror the data model, like our HTTP schemas.
const id = z.coerce.number().int().positive();           // DB SERIAL ids
const cellIndex = z.coerce.number().int().min(0).max(8); // 9x9 grid -> row/col 0-8
const cellValue = z.coerce.number().int().min(0).max(9); // 0 = empty, 1-9 = digit

const joinRoomSchema = z.object({ tournamentId: id });

const leaveRoomSchema = z.object({ tournamentId: id });

const cellFillSchema = z.object({
  tournamentId: id,
  roundId: id,
  puzzleId: id,
  row: cellIndex,
  col: cellIndex,
  value: cellValue,
});

// A standard sudoku grid: 9 rows of 9 cells (0-9).
const gridSchema = z.array(z.array(cellValue).length(9)).length(9);

// answer_submit has two shapes, selected by submissionType:
//   SINGLE_CELL -> { row, col, value }
//   FULL_GRID   -> { grid }
const answerSubmitSchema = z.discriminatedUnion('submissionType', [
  z.object({
    submissionType: z.literal('SINGLE_CELL'),
    tournamentId: id,
    roundId: id,
    puzzleId: id,
    row: cellIndex,
    col: cellIndex,
    value: cellValue,
  }),
  z.object({
    submissionType: z.literal('FULL_GRID'),
    tournamentId: id,
    roundId: id,
    puzzleId: id,
    grid: gridSchema,
  }),
]);

module.exports = {
  joinRoomSchema,
  leaveRoomSchema,
  cellFillSchema,
  answerSubmitSchema,
};
