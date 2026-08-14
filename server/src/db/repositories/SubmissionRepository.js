/**
 * Submission repository — abstracts submission-related database operations.
 *
 * NOTE: The legacy `submissions` table was dropped in migration 018.
 * Submissions are now tracked via `puzzle_answers` + `player_round_sessions`:
 *   - `puzzle_answers` (UUID PK, session_id, puzzle_id, current_grid JSONB,
 *     correct_cells, total_empty_cells, progress_percentage)
 *   - `player_round_sessions` (UUID PK, round_id, participant_id, status
 *     WAITING/PLAYING/SUBMITTED/AUTO_SUBMITTED, submitted_at?)
 *
 * A "correct" submission in the new schema is a puzzle_answer whose session is
 * in SUBMITTED/AUTO_SUBMITTED status and whose progress_percentage is 100
 * (i.e., all empty cells filled correctly). The legacy `is_correct` boolean
 * and `points_earned` int columns are gone; correctness is derived from
 * `correct_cells == total_empty_cells` when the session was submitted.
 *
 * Public method names are kept identical so route handlers keep working.
 * Methods that took teamId resolve team members via team_members.
 */

class SubmissionRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Resolve all participant_ids belonging to a team.
   * @private
   */
  async _teamParticipantIds(teamId) {
    const members = await this.prisma.team_members.findMany({
      where: { team_id: teamId },
      select: { participant_id: true },
    });
    return members.map((m) => m.participant_id);
  }

  /**
   * Create a submission record.
   *
   * The new schema has no dedicated `submissions` table; this method records
   * the answer on the player's `puzzle_answers` row and marks the session as
   * SUBMITTED if `isCorrect` is true. The `submissionType`, `submittedValue`
   * and `pointsEarned` parameters are accepted for backward compat but not
   * persisted (the new schema doesn't model them).
   *
   * @param {Object} params
   * @param {string} params.roundId
   * @param {string} params.playerId - Participant UUID.
   * @param {string} params.puzzleId
   * @param {string} [params.teamId] - Ignored (resolved via team_members).
   * @param {string} [params.submissionType] - Ignored.
   * @param {object|string} [params.submittedValue] - Stored as current_grid if provided.
   * @param {boolean} [params.isCorrect] - If true, session is marked SUBMITTED.
   * @param {number} [params.pointsEarned] - Ignored.
   */
  async create({ roundId, playerId, puzzleId, teamId, submissionType, submittedValue, isCorrect, pointsEarned }) {
    const session = await this.prisma.player_round_sessions.upsert({
      where: {
        round_id_participant_id: {
          round_id: roundId,
          participant_id: playerId,
        },
      },
      create: {
        round_id: roundId,
        participant_id: playerId,
        status: 'WAITING',
      },
      update: {},
    });

    const grid = typeof submittedValue === 'string'
      ? JSON.parse(submittedValue)
      : (submittedValue || {});

    await this.prisma.puzzle_answers.upsert({
      where: {
        session_id_puzzle_id: {
          session_id: session.id,
          puzzle_id: puzzleId,
        },
      },
      create: {
        session_id: session.id,
        puzzle_id: puzzleId,
        current_grid: grid,
      },
      update: {
        current_grid: grid,
        updated_at: new Date(),
      },
    });

    if (isCorrect) {
      await this.prisma.player_round_sessions.update({
        where: { id: session.id },
        data: { status: 'SUBMITTED', submitted_at: new Date() },
      });
    }
  }

  /**
   * Find all puzzles correctly submitted by any member of a team in a round.
   * "Correct" = session status SUBMITTED/AUTO_SUBMITTED AND
   *             correct_cells = total_empty_cells.
   * @returns {Promise<object[]>} each: { puzzle_id, letter, order_in_round, puzzle_type }
   */
  async findTeamCorrect(roundId, teamId) {
    const participantIds = await this._teamParticipantIds(teamId);
    if (participantIds.length === 0) return [];

    const sessions = await this.prisma.player_round_sessions.findMany({
      where: {
        round_id: roundId,
        participant_id: { in: participantIds },
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
      },
      select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length === 0) return [];

    const answers = await this.prisma.puzzle_answers.findMany({
      where: {
        session_id: { in: sessionIds },
        // Correctness: all empty cells filled correctly.
        AND: [
          { correct_cells: { gt: 0 } },
          { total_empty_cells: { gt: 0 } },
        ],
      },
      include: {
        puzzles: {
          select: { id: true, type: true },
        },
        player_round_sessions: {
          select: { id: true },
        },
      },
    });

    // Filter to truly-correct (correct_cells = total_empty_cells) and dedupe by puzzle_id.
    const seen = new Set();
    const result = [];
    for (const a of answers) {
      if (a.correct_cells !== a.total_empty_cells) continue;
      if (seen.has(a.puzzle_id)) continue;
      seen.add(a.puzzle_id);
      result.push({
        puzzle_id: a.puzzle_id,
        letter: null, // letter column removed
        order_in_round: null, // order is on round_puzzles, not tracked here
        puzzle_type: a.puzzles?.type ?? null,
      });
    }
    return result;
  }

  /**
   * Find a single correct submission for a (team, puzzle) pair in a round.
   * Returns the first matching puzzle_answer, or null.
   */
  async findTeamSolvedPuzzle(roundId, teamId, puzzleId) {
    const participantIds = await this._teamParticipantIds(teamId);
    if (participantIds.length === 0) return null;

    const session = await this.prisma.player_round_sessions.findFirst({
      where: {
        round_id: roundId,
        participant_id: { in: participantIds },
        status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] },
      },
      include: {
        puzzle_answers: {
          where: {
            puzzle_id: puzzleId,
            AND: [
              { correct_cells: { gt: 0 } },
              { total_empty_cells: { gt: 0 } },
            ],
          },
        },
      },
    });
    if (!session || session.puzzle_answers.length === 0) return null;
    const a = session.puzzle_answers[0];
    if (a.correct_cells !== a.total_empty_cells) return null;
    return a;
  }

  /**
   * Find all puzzle IDs correctly solved by a team in a round.
   */
  async findSolvedPuzzleIds(roundId, teamId) {
    const correct = await this.findTeamCorrect(roundId, teamId);
    return correct.map((c) => c.puzzle_id);
  }

  /**
   * Find all JOC puzzles correctly solved by a team in a round.
   */
  async findTeamJocCorrect(roundId, teamId) {
    const correct = await this.findTeamCorrect(roundId, teamId);
    return correct.filter((c) => c.puzzle_type === 'JOC');
  }
}

module.exports = SubmissionRepository;
