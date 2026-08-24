/**
 * Competition repository — abstracts all competition-related database operations.
 *
 * Backs the `competitions` table (UUID PK, organization_id FK, status
 * DRAFT/PUBLISHED/RUNNING/FINISHED). Every competition belongs to exactly one
 * organization (multi-tenancy); the route layer is responsible for sourcing
 * and passing organization_id on create, and for scoping findAll() by it.
 *
 * Schema: competitions table —
 *   id (uuid PK), organization_id (uuid FK → organizations),
 *   name (varchar 255), description (text?),
 *   status (varchar 50, default 'DRAFT'),
 *   display_access_token (varchar 255?), competition_access_code (varchar 20? unique),
 *   created_at, updated_at (timestamptz).
 *
 * Status mapping (legacy → new):
 *   PENDING      → DRAFT
 *   IN_PROGRESS  → RUNNING
 *   PAUSED       → RUNNING (no direct equivalent; rounds have their own status)
 *   FINISHED     → FINISHED
 */

class CompetitionRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Find a single competition by its UUID.
   * @param {string} id - UUID of the competition.
   * @returns {Promise<object|null>}
   */
  async findById(id) {
    return this.prisma.competitions.findUnique({ where: { id } });
  }

  /**
   * List competitions, newest first.
   *
   * The optional `organizationId` scopes the result to one tenant. The route
   * layer decides whether to pass it: an ORG_ADMIN passes its own org id so it
   * only sees its competitions; a SUPER_ADMIN (platform owner) omits it to list
   * every competition across all organizations. The repository does not guess
   * — it filters only when the argument is provided.
   *
   * @param {string} [organizationId] - UUID of the organization to scope to.
   *   When undefined/null, returns competitions from all organizations.
   * @returns {Promise<object[]>}
   */
  async findAll(organizationId) {
    return this.prisma.competitions.findMany({
      where: organizationId ? { organization_id: organizationId } : {},
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Create a new competition.
   * @param {Object} params
   * @param {string} params.name - Competition name (1-255 chars).
   * @param {string} [params.description] - Optional description.
   * @param {string} [params.scheduledTime] - Ignored in new schema (kept for
   *   backward compatibility with route handlers that still pass it).
   * @param {string} [params.createdBy] - Ignored in new schema (kept for
   *   backward compatibility). Use organizationId instead.
   * @param {string} [params.organizationId] - UUID of the owning organization.
   *   Required for multi-tenancy. If missing, the row will fail the
   *   organization_id NOT NULL constraint.
   * @returns {Promise<object>} The created competition.
   */
  async create({ name, description, scheduledTime, createdBy, organizationId }) {
    return this.prisma.competitions.create({
      data: {
        name,
        description: description || null,
        organization_id: organizationId,
        // status defaults to 'DRAFT' via Prisma schema.
      },
    });
  }

  /**
   * Partially update a competition.
   * Only name and description are editable; status changes go through
   * updateStatus(). scheduledTime is kept in the signature for backward
   * compatibility but has no column in the new schema (it is ignored).
   * @param {string} id - UUID of the competition.
   * @param {Object} updates - Fields to update.
   * @returns {Promise<object|null>} The updated competition, or null if not found.
   */
  async update(id, { name, description, scheduledTime } = {}) {
    const existing = await this.findById(id);
    if (!existing) return null;

    const data = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    // scheduledTime has no column in the new schema — silently ignored.
    // updated_at is auto-managed by Prisma (@default(now()) + onUpdate trigger).

    if (Object.keys(data).length === 0) {
      return existing;
    }

    return this.prisma.competitions.update({ where: { id }, data });
  }

  /**
   * Change a competition's status.
   * @param {string} id - UUID of the competition.
   * @param {string} status - New status (DRAFT, PUBLISHED, RUNNING, FINISHED).
   * @returns {Promise<void>}
   */
  async updateStatus(id, status) {
    await this.prisma.competitions.update({
      where: { id },
      data: { status },
    });
  }

  /**
   * Delete a single competition (without cascading — fails if child rows
   * exist, which is what we want for a safety check).
   * @param {string} id - UUID of the competition.
   * @returns {Promise<void>}
   */
  async deleteById(id) {
    await this.prisma.competitions.delete({ where: { id } });
  }

  /**
   * Delete a competition and ALL dependent child records atomically.
   *
   * Only SOME foreign keys pointing at a competition cascade in the database:
   *
   *   competition_stages → CASCADE   (and stages → rounds → round_puzzles)
   *   teams              → CASCADE   (and teams → team_members)
   *   competition_judges → CASCADE
   *   players            → NO ACTION ← blocks the delete
   *
   * Four more relations are NO ACTION and block it indirectly:
   * player_round_sessions (→ players, → rounds), round_rankings (→ players,
   * → teams) and final_rankings (→ competition_stages).
   *
   * A bare competitions.delete() therefore throws a foreign-key violation as
   * soon as the competition has a single participant. The blocking rows are
   * removed here first, in dependency order; puzzle_answers follow their
   * session by cascade.
   *
   * @param {string} id - UUID of the competition.
   * @returns {Promise<void>}
   */
  async deleteCascade(id) {
    await this.prisma.$transaction(async (tx) => {
      const stages = await tx.competition_stages.findMany({
        where: { competition_id: id },
        select: { id: true },
      });
      const stageIds = stages.map((s) => s.id);

      const rounds = stageIds.length
        ? await tx.rounds.findMany({ where: { stage_id: { in: stageIds } }, select: { id: true } })
        : [];
      const roundIds = rounds.map((r) => r.id);

      const players = await tx.players.findMany({
        where: { competition_id: id },
        select: { id: true },
      });
      const playerIds = players.map((p) => p.id);

      if (roundIds.length || playerIds.length) {
        await tx.player_round_sessions.deleteMany({
          where: {
            OR: [
              ...(roundIds.length ? [{ round_id: { in: roundIds } }] : []),
              ...(playerIds.length ? [{ participant_id: { in: playerIds } }] : []),
            ],
          },
        });
      }

      if (roundIds.length) {
        await tx.round_rankings.deleteMany({ where: { round_id: { in: roundIds } } });
      }
      if (stageIds.length) {
        await tx.final_rankings.deleteMany({ where: { competition_stage_id: { in: stageIds } } });
      }
      if (playerIds.length) {
        await tx.players.deleteMany({ where: { id: { in: playerIds } } });
      }

      await tx.competitions.delete({ where: { id } });
    });
  }

  /**
   * Find the first active round in a competition.
   *
   * In the new schema, rounds belong to competition_stages (which belong to
   * competitions), and "active" means the round's status is RUNNING or
   * (legacy) PAUSED. The new schema uses status values: WAITING, RUNNING,
   * FINISHED (and a few transitional ones). PAUSED has no direct equivalent.
   *
   * @param {string} competitionId - UUID of the competition.
   * @returns {Promise<object|null>} The first active round, or null.
   */
  async findActiveRound(competitionId) {
    // Traverse: competition → competition_stages → rounds, filter by status.
    const stages = await this.prisma.competition_stages.findMany({
      where: { competition_id: competitionId },
      include: {
        rounds: {
          where: {
            status: { in: ['RUNNING', 'PAUSED'] },
          },
          orderBy: { order_number: 'asc' },
        },
      },
      orderBy: { order_number: 'asc' },
    });

    for (const stage of stages) {
      if (stage.rounds.length > 0) {
        return stage.rounds[0];
      }
    }
    return null;
  }

  /**
   * Same shape as findActiveRound but for rounds in the preparation
   * phase. `preparation` sits in-between two rounds: DB status is still
   * PENDING but the orchestrator has started a `prep_<roundId>` timer.
   * The caller checks the timer to distinguish "prep is running" from
   * "round has never been touched".
   *
   * Introduced 2026-08-24 for the `/my-state` fix: a player who
   * refreshes their page during the prep countdown used to fall back
   * to the waiting screen because /my-state only knew about
   * IN_PROGRESS. Now the route can ask for a PENDING round, check the
   * prep timer, and reply with a `preparation` payload.
   *
   * @param {string} competitionId
   * @returns {Promise<object|null>}
   */
  async findPreparingRound(competitionId) {
    const stages = await this.prisma.competition_stages.findMany({
      where: { competition_id: competitionId },
      include: {
        rounds: {
          where: { status: 'PENDING' },
          orderBy: { order_number: 'asc' },
        },
      },
      orderBy: { order_number: 'asc' },
    });
    for (const stage of stages) {
      if (stage.rounds.length > 0) {
        return stage.rounds[0];
      }
    }
    return null;
  }
}

module.exports = CompetitionRepository;
