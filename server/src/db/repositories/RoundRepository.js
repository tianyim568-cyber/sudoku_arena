/**
 * Round repository — abstracts all round-related database operations.
 *
 * NOTE: The legacy `rounds` table was dropped in migration 018. This
 * repository now backs the new `rounds` table (UUID PK, stage_id FK →
 * competition_stages, type/order_number/duration_seconds columns).
 *
 * Schema: rounds table —
 *   id (uuid PK), stage_id (uuid FK → competition_stages),
 *   name (varchar 255), type (varchar 50), order_number (int),
 *   duration_seconds (int), preparation_seconds (int default 10),
 *   waiting_seconds (int default 0),
 *   status (varchar 50, default 'WAITING') — values: WAITING/RUNNING/FINISHED,
 *   started_at (timestamptz?), ended_at (timestamptz?), created_at (timestamptz).
 *
 * Legacy → new column mapping:
 *   round_type      → type
 *   round_number    → order_number
 *   tournament_id   → (gone) — rounds belong to a stage, which belongs to a competition
 *   remaining_seconds → (gone) — timing is application-layer now
 *   status IN_PROGRESS → RUNNING, NOT_STARTED → WAITING, PAUSED → (no direct equivalent)
 *
 * Public method names are kept identical so route handlers keep working.
 * Methods that take `competitionId` traverse competition_stages to find
 * rounds belonging to a competition.
 */

class RoundRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Find a single round by its UUID.
   */
  async findById(id) {
    return this.prisma.rounds.findUnique({ where: { id } });
  }

  /**
   * Find a stage by its UUID.
   *
   * Rounds hang off a stage, so the route layer needs to read the stage back
   * to check two things before creating one: that it belongs to the
   * competition in the URL, and that its type matches the round type.
   *
   * @param {string} stageId - UUID of the stage.
   * @returns {Promise<object|null>} The competition_stages row, or null.
   */
  async findStageById(stageId) {
    return this.prisma.competition_stages.findUnique({ where: { id: stageId } });
  }

  /**
   * Find all rounds for a competition, ordered by stage then round order.
   * (Legacy name: findByCompetition — kept for backward compat. Traverses
   * competition_stages since rounds no longer have a direct competition_id.)
   * @param {string} competitionId - UUID of the competition.
   * @returns {Promise<object[]>}
   */
  async findByCompetition(competitionId) {
    const stages = await this.prisma.competition_stages.findMany({
      where: { competition_id: competitionId },
      include: {
        rounds: { orderBy: { order_number: 'asc' } },
      },
      orderBy: { order_number: 'asc' },
    });
    return stages.flatMap((s) => s.rounds);
  }

  /**
   * Find the first round in a competition matching the given status.
   * @param {string} competitionId
   * @param {string} status - WAITING / RUNNING / FINISHED
   * @returns {Promise<object|null>}
   */
  async findByCompetitionAndStatus(competitionId, status) {
    const stages = await this.prisma.competition_stages.findMany({
      where: { competition_id: competitionId },
      include: {
        rounds: {
          where: { status },
          orderBy: { order_number: 'asc' },
        },
      },
      orderBy: { order_number: 'asc' },
    });
    for (const stage of stages) {
      if (stage.rounds.length > 0) return stage.rounds[0];
    }
    return null;
  }

  /**
   * Find all rounds in a competition whose status differs from `status`.
   * @param {string} competitionId
   * @param {string} status
   * @returns {Promise<object[]>}
   */
  async findByCompetitionNotStatus(competitionId, status) {
    const stages = await this.prisma.competition_stages.findMany({
      where: { competition_id: competitionId },
      include: {
        rounds: {
          where: { NOT: { status } },
          orderBy: { order_number: 'asc' },
        },
      },
      orderBy: { order_number: 'asc' },
    });
    return stages.flatMap((s) => s.rounds);
  }

  /**
   * Create a new round.
   *
   * Legacy callers passed `competitionId` (now `competitionId`); the new schema
   * requires `stageId`. For backward compatibility, if `competitionId` is passed
   * without `stageId`, we create/find the first stage of the competition and
   * attach the round to it.
   *
   * @param {Object} params
   * @param {string} [params.competitionId] - Competition UUID. Used to resolve
   *   a stage if stageId is not provided.
   * @param {string} [params.stageId] - Stage UUID (preferred). If absent, the
   *   first stage of the competition is used (created if none exists).
   * @param {number} params.roundNumber - Ignored; order_number is computed from
   *   existing rounds in the stage. Kept in signature for backward compat.
   * @param {string} params.name - Round name.
   * @param {string} params.roundType - Maps to `type` in new schema.
   * @param {number} params.durationSeconds - Round duration in seconds.
   * @returns {Promise<object>} The created round.
   */
  async create({ competitionId, stageId, roundNumber, name, roundType, durationSeconds, preparationSeconds }) {
    let resolvedStageId = stageId;

    if (!resolvedStageId && competitionId) {
      // Find or create the first stage for this competition.
      let stage = await this.prisma.competition_stages.findFirst({
        where: { competition_id: competitionId },
        orderBy: { order_number: 'asc' },
      });
      if (!stage) {
        stage = await this.prisma.competition_stages.create({
          data: {
            competition_id: competitionId,
            type: roundType || 'STANDARD',
            order_number: 1,
          },
        });
      }
      resolvedStageId = stage.id;
    }

    if (!resolvedStageId) {
      throw new Error('RoundRepository.create requires either stageId or competitionId');
    }

    // Compute the next order_number inside this stage.
    const existingCount = await this.prisma.rounds.count({
      where: { stage_id: resolvedStageId },
    });

    return this.prisma.rounds.create({
      data: {
        stage_id: resolvedStageId,
        name,
        type: roundType || 'STANDARD',
        order_number: roundNumber !== undefined ? roundNumber : existingCount + 1,
        duration_seconds: durationSeconds,
        // Only written when the caller supplied one, so the schema default
        // (10s) stays the single place that number is decided.
        ...(preparationSeconds != null ? { preparation_seconds: preparationSeconds } : {}),
        // status defaults to 'WAITING' via schema.
      },
    });
  }

  /**
   * Update a round's status and optional timing fields.
   * @param {string} id - Round UUID.
   * @param {string} status - New status (WAITING/RUNNING/FINISHED).
   * @param {Object} [extraFields] - Optional: started_at, ended_at.
   */
  async updateStatus(id, status, extraFields = {}) {
    const data = { status };
    if (extraFields.started_at) data.started_at = extraFields.started_at;
    if (extraFields.ended_at) data.ended_at = extraFields.ended_at;
    // remaining_seconds is gone in the new schema — ignored.
    await this.prisma.rounds.update({ where: { id }, data });
  }

  /**
   * Mark a round as RUNNING and record the start time.
   * @param {string} id - Round UUID.
   * @param {number} durationSeconds - Ignored in new schema (duration is stored
   *   on the round itself); kept in signature for backward compat.
   */
  async startRound(id, durationSeconds) {
    await this.prisma.rounds.update({
      where: { id },
      data: {
        status: 'RUNNING',
        started_at: new Date(),
      },
    });
  }

  /**
   * Mark a round as FINISHED and record the end time.
   */
  async finishRound(id) {
    await this.prisma.rounds.update({
      where: { id },
      data: {
        status: 'FINISHED',
        ended_at: new Date(),
      },
    });
  }

  /**
   * Pause a round. The new schema has no PAUSED status; rounds are either
   * WAITING, RUNNING, or FINISHED. We keep the method for backward compat
   * but it maps to WAITING (round is no longer actively running).
   * @param {string} id - Round UUID.
   * @param {number} remainingSeconds - Ignored (timing is app-layer now).
   */
  async pauseRound(id, remainingSeconds) {
    await this.prisma.rounds.update({
      where: { id },
      data: { status: 'WAITING' },
    });
  }

  /**
   * Resume a paused round by setting it back to RUNNING.
   */
  async resumeRound(id) {
    await this.prisma.rounds.update({
      where: { id },
      data: { status: 'RUNNING' },
    });
  }

  /**
   * Count the number of rounds in a competition.
   * (Legacy name: countByCompetition — kept for backward compat.)
   * @param {string} competitionId
   * @returns {Promise<number>}
   */
  async countByCompetition(competitionId) {
    const stages = await this.prisma.competition_stages.findMany({
      where: { competition_id: competitionId },
      select: { id: true },
    });
    const stageIds = stages.map((s) => s.id);
    if (stageIds.length === 0) return 0;
    return this.prisma.rounds.count({
      where: { stage_id: { in: stageIds } },
    });
  }

  /**
   * Find all rounds for a competition with their puzzles (via round_puzzles).
   * (Legacy name: findWithPuzzles — kept for backward compat.)
   * @param {string} competitionId
   * @returns {Promise<object[]>} rounds each with a `puzzles` array.
   */
  async findWithPuzzles(competitionId) {
    const rounds = await this.findByCompetition(competitionId);
    for (const r of rounds) {
      const links = await this.prisma.round_puzzles.findMany({
        where: { round_id: r.id },
        orderBy: { order_number: 'asc' },
        include: {
          puzzles: {
            select: {
              id: true,
              type: true,
              score: true,
              difficulty: true,
            },
          },
        },
      });
      // Shape matches legacy callers: id, puzzle_type, order_in_round, points.
      r.puzzles = links.map((l) => ({
        id: l.puzzles.id,
        puzzle_type: l.puzzles.type,
        order_in_round: l.order_number,
        points: l.score,
        letter: null, // letter column removed in new schema
      }));
    }
    return rounds;
  }
}

module.exports = RoundRepository;
