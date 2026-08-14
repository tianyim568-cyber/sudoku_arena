/**
 * Player state repository — abstracts player_round_sessions and puzzle_answers.
 *
 * NOTE: The legacy `player_round_states` and `player_puzzle_assignments` tables
 * were dropped in migration 018. This repository now backs:
 *   - `player_round_sessions` (UUID PK, round_id, participant_id, started_at,
 *     submitted_at?, status WAITING/PLAYING/SUBMITTED/AUTO_SUBMITTED)
 *     unique on (round_id, participant_id)
 *   - `puzzle_answers` (UUID PK, session_id, puzzle_id, current_grid JSONB,
 *     correct_cells, total_empty_cells, progress_percentage)
 *     unique on (session_id, puzzle_id)
 *
 * Legacy → new column mapping:
 *   player_round_states.player_id  → player_round_sessions.participant_id
 *   player_round_states.team_id    → (gone — team resolved via team_members)
 *   player_puzzle_assignments.player_id → (gone — tracked via session.participant_id)
 *   player_puzzle_assignments.round_id  → (gone — tracked via session.round_id)
 *   player_puzzle_assignments.team_id   → (gone)
 *   player_puzzle_assignments.current_grid (TEXT) → puzzle_answers.current_grid (JSONB)
 *   player_puzzle_assignments.is_completed (0/1)  → session.status (SUBMITTED/AUTO_SUBMITTED)
 *
 * Public method names are kept identical so route handlers keep working.
 * Methods that took (roundId, playerId) now resolve or create a session first,
 * then operate on puzzle_answers scoped to that session.
 */

class PlayerStateRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // --- Player Round Sessions ---

  /**
   * Create a player_round_session for a (round, participant) pair.
   * Idempotent: if a session already exists, it is left unchanged.
   * @param {Object} params
   * @param {string} params.roundId
   * @param {string} params.playerId - Participant UUID (legacy name kept).
   * @param {string} [params.teamId] - Ignored (no team_id on sessions).
   * @param {string} [params.status] - Default 'WAITING'.
   */
  async createRoundState({ roundId, playerId, teamId, status }) {
    await this.prisma.player_round_sessions.upsert({
      where: {
        round_id_participant_id: {
          round_id: roundId,
          participant_id: playerId,
        },
      },
      create: {
        round_id: roundId,
        participant_id: playerId,
        status: status || 'WAITING',
      },
      update: {}, // leave existing session untouched
    });
  }

  /**
   * Resolve the session for a (round, participant) pair, creating it if needed.
   * @private
   */
  async _ensureSession(roundId, participantId) {
    await this.createRoundState({ roundId, playerId: participantId });
    return this.prisma.player_round_sessions.findUnique({
      where: {
        round_id_participant_id: {
          round_id: roundId,
          participant_id: participantId,
        },
      },
    });
  }

  // --- Puzzle Answers ---

  /**
   * Create a puzzle_answer row for a (round, participant, puzzle) triple.
   * @param {Object} params
   * @param {string} params.roundId
   * @param {string} params.playerId - Participant UUID.
   * @param {string} params.puzzleId
   * @param {string} [params.teamId] - Ignored (no team_id on puzzle_answers).
   * @param {object|string} [params.currentGrid] - Initial grid state (JSON or string).
   * @param {boolean} [params.isCompleted] - If true, status is set to SUBMITTED on the session.
   */
  async createAssignment({ roundId, playerId, puzzleId, teamId, currentGrid, isCompleted }) {
    const session = await this._ensureSession(roundId, playerId);

    const parsedGrid = typeof currentGrid === 'string'
      ? JSON.parse(currentGrid)
      : (currentGrid || null);

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
        current_grid: parsedGrid ?? {},
      },
      update: {
        current_grid: parsedGrid ?? {},
      },
    });

    if (isCompleted) {
      await this.prisma.player_round_sessions.update({
        where: { id: session.id },
        data: { status: 'SUBMITTED', submitted_at: new Date() },
      });
    }
  }

  /**
   * Find a player's active (not-yet-submitted) puzzle_answer for a puzzle.
   * Returns null if the session is already submitted or no answer exists.
   */
  async findActiveAssignment(roundId, playerId, puzzleId) {
    const session = await this.prisma.player_round_sessions.findUnique({
      where: {
        round_id_participant_id: {
          round_id: roundId,
          participant_id: playerId,
        },
      },
    });
    if (!session) return null;
    if (session.status === 'SUBMITTED' || session.status === 'AUTO_SUBMITTED') return null;

    return this.prisma.puzzle_answers.findUnique({
      where: {
        session_id_puzzle_id: {
          session_id: session.id,
          puzzle_id: puzzleId,
        },
      },
    });
  }

  /**
   * Find any puzzle_answer for a (round, participant, puzzle) triple,
   * regardless of completion status.
   */
  async findAnyAssignment(roundId, playerId, puzzleId) {
    const session = await this.prisma.player_round_sessions.findUnique({
      where: {
        round_id_participant_id: {
          round_id: roundId,
          participant_id: playerId,
        },
      },
    });
    if (!session) return null;

    return this.prisma.puzzle_answers.findUnique({
      where: {
        session_id_puzzle_id: {
          session_id: session.id,
          puzzle_id: puzzleId,
        },
      },
    });
  }

  /**
   * Find all active (not-submitted) puzzle answers for a player in a round,
   * joined with the puzzle details.
   */
  async findPlayerAssignments(roundId, playerId) {
    const session = await this.prisma.player_round_sessions.findUnique({
      where: {
        round_id_participant_id: {
          round_id: roundId,
          participant_id: playerId,
        },
      },
    });
    if (!session) return [];
    if (session.status === 'SUBMITTED' || session.status === 'AUTO_SUBMITTED') return [];

    const answers = await this.prisma.puzzle_answers.findMany({
      where: { session_id: session.id },
      include: {
        puzzles: true,
      },
    });

    // Shape: legacy callers expected puzzle + current_grid + is_completed fields.
    return answers.map((a) => ({
      ...a.puzzles,
      puzzle_type: a.puzzles.type,
      current_grid: a.current_grid,
      is_completed: 0, // active session, by definition not yet completed
    }));
  }

  /**
   * Find all puzzle_answers for all players in a team for a round.
   *
   * The new schema has no team_id on puzzle_answers. We resolve the team's
   * members and fetch their sessions' answers.
   */
  async findTeamAssignments(roundId, teamId) {
    const members = await this.prisma.team_members.findMany({
      where: { team_id: teamId },
      select: { participant_id: true },
    });
    const participantIds = members.map((m) => m.participant_id);
    if (participantIds.length === 0) return [];

    const sessions = await this.prisma.player_round_sessions.findMany({
      where: {
        round_id: roundId,
        participant_id: { in: participantIds },
      },
      include: {
        puzzle_answers: true,
      },
    });
    return sessions.flatMap((s) =>
      s.puzzle_answers.map((a) => ({
        ...a,
        round_id: roundId,
        player_id: s.participant_id, // legacy alias
        team_id: teamId,
        is_completed: s.status === 'SUBMITTED' || s.status === 'AUTO_SUBMITTED' ? 1 : 0,
      }))
    );
  }

  /**
   * Find all puzzle_answers for a specific puzzle, for all players in a team.
   */
  async findTeamAssignmentsForPuzzle(roundId, puzzleId, teamId) {
    const all = await this.findTeamAssignments(roundId, teamId);
    return all.filter((a) => a.puzzle_id === puzzleId);
  }

  /**
   * Mark a puzzle_answer as completed by setting its session to SUBMITTED.
   * @param {string} id - puzzle_answers.id (UUID).
   */
  async markCompleted(id) {
    const answer = await this.prisma.puzzle_answers.findUnique({
      where: { id },
      select: { session_id: true },
    });
    if (!answer) return;
    await this.prisma.player_round_sessions.update({
      where: { id: answer.session_id },
      data: { status: 'SUBMITTED', submitted_at: new Date() },
    });
  }

  /**
   * Mark all team members' puzzle_answers for a specific puzzle as completed.
   */
  async markTeamAssignmentsCompleted(roundId, puzzleId, teamId) {
    const assignments = await this.findTeamAssignmentsForPuzzle(roundId, puzzleId, teamId);
    for (const a of assignments) {
      await this.markCompleted(a.id);
    }
  }

  /**
   * Update the current_grid of a puzzle_answer.
   * @param {string} id - puzzle_answers.id (UUID).
   * @param {object|string} gridJSON - New grid state (JSON or string).
   */
  async updateCurrentGrid(id, gridJSON) {
    const parsed = typeof gridJSON === 'string' ? JSON.parse(gridJSON) : gridJSON;
    await this.prisma.puzzle_answers.update({
      where: { id },
      data: { current_grid: parsed, updated_at: new Date() },
    });
  }

  /**
   * Delete a player's active (not-submitted) puzzle_answer for a puzzle.
   */
  async deleteUncompletedAssignment(roundId, playerId, puzzleId) {
    const session = await this.prisma.player_round_sessions.findUnique({
      where: {
        round_id_participant_id: {
          round_id: roundId,
          participant_id: playerId,
        },
      },
    });
    if (!session) return;
    if (session.status === 'SUBMITTED' || session.status === 'AUTO_SUBMITTED') return;

    await this.prisma.puzzle_answers.deleteMany({
      where: { session_id: session.id, puzzle_id: puzzleId },
    });
  }

  /**
   * Find all puzzle IDs assigned to a team in a round.
   * Returns the distinct puzzle_ids from all team members' answers.
   */
  async findAssignedPuzzleIds(roundId, teamId) {
    const members = await this.prisma.team_members.findMany({
      where: { team_id: teamId },
      select: { participant_id: true },
    });
    const participantIds = members.map((m) => m.participant_id);
    if (participantIds.length === 0) return [];

    const sessions = await this.prisma.player_round_sessions.findMany({
      where: {
        round_id: roundId,
        participant_id: { in: participantIds },
      },
      select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length === 0) return [];

    const answers = await this.prisma.puzzle_answers.findMany({
      where: { session_id: { in: sessionIds } },
      distinct: ['puzzle_id'],
      select: { puzzle_id: true },
    });
    return answers.map((a) => a.puzzle_id);
  }
}

module.exports = PlayerStateRepository;
