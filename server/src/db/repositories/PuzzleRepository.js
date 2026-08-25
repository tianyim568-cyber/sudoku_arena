/**
 * Puzzle repository — abstracts puzzle-related database operations.
 *
 * NOTE: The legacy `puzzles` table was dropped in migration 018. This
 * repository now backs the new `puzzles` table (UUID PK, type, initial_grid
 * JSONB, solution_grid JSONB, difficulty, score, category_id) plus the
 * `round_puzzles` junction (UUID PK, round_id, puzzle_id, order_number, score,
 * category_id) for puzzle-to-round assignment.
 *
 * Legacy → new column mapping:
 *   puzzle_type    → type
 *   initial_grid (TEXT) → initial_grid (JSONB)
 *   solution (TEXT)     → solution_grid (JSONB)
 *   points         → score
 *   round_id       → (gone from puzzles) → round_puzzles.round_id
 *   order_in_round → (gone from puzzles) → round_puzzles.order_number
 *   letter         → (gone — no equivalent in new schema)
 *   team_id        → (gone — team assignment is via team_members + puzzle_answers)
 *   difficulty     → difficulty (kept)
 *
 * Public method names are kept identical so route handlers keep working.
 * Methods that took `roundId` traverse the round_puzzles junction.
 */

class PuzzleRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Find a single puzzle by its UUID.
   */
  async findById(id) {
    return this.prisma.puzzles.findUnique({ where: { id } });
  }

  /**
   * Find a single puzzle by UUID, but only if it belongs to the given
   * organization. Returns null if the puzzle doesn't exist or is owned
   * by a different tenant — callers can't tell the two apart by design
   * (no information leak across tenants).
   *
   * @param {string} id - Puzzle UUID.
   * @param {string} organizationId - Calling org's UUID.
   * @returns {Promise<object|null>}
   */
  async findByIdAndOrg(id, organizationId) {
    return this.prisma.puzzles.findFirst({
      where: { id, organization_id: organizationId },
    });
  }

  /**
   * List puzzles belonging to an organization, with optional filters.
   *
   * Replaces the old in-memory filtering done on puzzle-bank.json. The
   * `roundType` filter is handled separately (see _roundTypeClause)
   * because the new schema has no `round_type` column on puzzles —
   * puzzles are round-agnostic until linked via round_puzzles.
   *
   * @param {object} opts
   * @param {string} opts.organizationId
   * @param {string} [opts.roundType]    - Round type hint (metadata, not a column).
   * @param {string} [opts.difficulty]
   * @param {string} [opts.puzzleType]   - Maps to `type`.
   * @param {number} [opts.limit]
   * @param {number} [opts.offset]
   */
  async findByOrganization({
    organizationId,
    roundType,
    difficulty,
    puzzleType,
    limit,
    offset,
  } = {}) {
    const where = { organization_id: organizationId };
    if (difficulty) where.difficulty = difficulty;
    if (puzzleType) where.type = puzzleType;
    if (roundType) where.round_type = roundType;

    const take = limit ? parseInt(limit) : undefined;
    const skip = offset ? parseInt(offset) : 0;

    const [rows, total] = await Promise.all([
      this.prisma.puzzles.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take,
        skip,
      }),
      this.prisma.puzzles.count({ where }),
    ]);

    return { total, puzzles: rows };
  }

  /**
   * Create a puzzle in the library WITHOUT attaching it to a round.
   *
   * Use this when an admin generates puzzles into the bank for later
   * assignment (e.g. the old generatePuzzles → importToRound flow).
   * The puzzle is stamped with the owning organization_id so listing
   * by tenant works at the DB level.
   *
   * NOTE: The new schema has no `order_in_round`, `letter` or `team_id`
   * columns on puzzles — those concepts live in round_puzzles or are
   * gone entirely. The legacy caller still passes them; we accept them
   * for API stability and drop them silently.
   */
  async createStandalone({
    organizationId,
    puzzleType,
    initialGrid,
    solution,
    points,
    difficulty,
    categoryId,
    source,
    roundType,
    // Legacy fields kept for caller-compat but not stored on the row:
    orderInRound, letter, teamId,
  }) {
    const parsedInitial = typeof initialGrid === 'string' ? JSON.parse(initialGrid) : initialGrid;
    const parsedSolution = typeof solution === 'string' ? JSON.parse(solution) : solution;

    return this.prisma.puzzles.create({
      data: {
        type: puzzleType || 'STANDARD',
        initial_grid: parsedInitial,
        solution_grid: parsedSolution,
        difficulty: difficulty || null,
        score: points || 100,
        organization_id: organizationId || null,
        category_id: categoryId || null,
        round_type: roundType || null,
      },
    });
  }

  /**
   * Attach an existing puzzle to a round (junction row in round_puzzles).
   *
   * Used by importToRound when puzzles already exist in the library
   * (generated earlier or imported via PDF) and now need to be linked
   * to a specific round with an order number.
   */
  async attachToRound({ roundId, puzzleId, orderInRound, points }) {
    let order = orderInRound;
    if (order === undefined) {
      const existing = await this.prisma.round_puzzles.count({ where: { round_id: roundId } });
      order = existing + 1;
    }
    return this.prisma.round_puzzles.create({
      data: {
        round_id: roundId,
        puzzle_id: puzzleId,
        order_number: order,
        score: points || 100,
      },
    });
  }

  /**
   * Count puzzles belonging to an organization.
   *
   * Used by PuzzleBankService.generatePuzzles to report totalInBank
   * after a generation run. Replaces the old `bank.puzzles.length`.
   */
  async countByOrganization(organizationId) {
    return this.prisma.puzzles.count({
      where: { organization_id: organizationId },
    });
  }

  /**
   * Find puzzles by their UUIDs (batch lookup).
   *
   * Used by importToRound when the caller passes an explicit list of
   * puzzle IDs to import. Returns the full rows including solution.
   */
  async findByIds(ids) {
    if (!ids || ids.length === 0) return [];
    return this.prisma.puzzles.findMany({
      where: { id: { in: ids } },
    });
  }

  /**
   * Delete a single puzzle from the library, but only if it belongs to
   * the given organization. Round links are cascade-deleted via FK.
   */
  async deleteByIdAndOrg(id, organizationId) {
    // findFirst to check tenant, then delete. Two queries instead of
    // a deleteMany({id, organization_id}) because the caller expects
    // to know whether the puzzle existed at all (to return 404 vs 200).
    const row = await this.prisma.puzzles.findFirst({
      where: { id, organization_id: organizationId },
      select: { id: true },
    });
    if (!row) return null;
    await this.prisma.puzzles.delete({ where: { id: row.id } });
    return row;
  }

  /**
   * Find all puzzles assigned to a round, ordered by their order_number in
   * the round_puzzles junction.
   */
  async findByRound(roundId) {
    const links = await this.prisma.round_puzzles.findMany({
      where: { round_id: roundId },
      orderBy: { order_number: 'asc' },
      include: { puzzles: true },
    });
    return links.map((l) => this._shape(l.puzzles, l));
  }

  /**
   * Find all puzzles assigned to a round, summary view (no grids).
   */
  async findByRoundSummary(roundId) {
    const links = await this.prisma.round_puzzles.findMany({
      where: { round_id: roundId },
      orderBy: { order_number: 'asc' },
      include: {
        puzzles: {
          select: { id: true, type: true, score: true, difficulty: true },
        },
      },
    });
    return links.map((l) => ({
      id: l.puzzles.id,
      puzzle_type: l.puzzles.type,
      order_in_round: l.order_number,
      points: l.score, // junction score takes precedence over puzzle.score
      letter: null, // letter column removed in new schema
    }));
  }

  /**
   * Find all puzzles assigned to a round for a specific team.
   *
   * The new schema has no team_id on puzzles or round_puzzles — all puzzles
   * in a round are shared across teams. This method therefore returns the
   * same as findByRound; the teamId parameter is kept for backward compat.
   */
  async findByRoundAndTeam(roundId, teamId) {
    return this.findByRound(roundId);
  }

  /**
   * Find JOC-type puzzles in a round.
   */
  async findJocPuzzles(roundId) {
    const links = await this.prisma.round_puzzles.findMany({
      where: { round_id: roundId, puzzles: { type: 'JOC' } },
      orderBy: { order_number: 'asc' },
      include: { puzzles: true },
    });
    return links.map((l) => this._shape(l.puzzles, l));
  }

  /**
   * Find JOC puzzles assigned to a specific team in a round.
   *
   * The new schema has no team-puzzle assignment table. All puzzles in a round
   * are shared; this method therefore returns the same as findJocPuzzles.
   * (Kept for backward compat with callers that pass a teamId.)
   */
  async findTeamJocPuzzles(roundId, teamId) {
    return this.findJocPuzzles(roundId);
  }

  /**
   * Find FINAL-type puzzles in a round.
   */
  async findFinalPuzzles(roundId) {
    const links = await this.prisma.round_puzzles.findMany({
      where: { round_id: roundId, puzzles: { type: 'FINAL' } },
      orderBy: { order_number: 'asc' },
      include: { puzzles: true },
    });
    return links.map((l) => this._shape(l.puzzles, l));
  }

  /**
   * Count puzzles assigned to a round.
   */
  async countByRound(roundId) {
    return this.prisma.round_puzzles.count({ where: { round_id: roundId } });
  }

  /**
   * Count JOC puzzles in a round.
   */
  async countJocByRound(roundId) {
    return this.prisma.round_puzzles.count({
      where: { round_id: roundId, puzzles: { type: 'JOC' } },
    });
  }

  /**
   * Count JOC puzzles assigned to a team in a round.
   * New schema shares puzzles across teams — returns the round's JOC count.
   */
  async countTeamJoc(roundId, teamId) {
    return this.countJocByRound(roundId);
  }

  /**
   * Find the FINAL puzzle assigned to a team in a round.
   * New schema shares puzzles across teams — returns the round's first FINAL puzzle.
   */
  async findTeamFinalPuzzle(roundId, teamId) {
    const links = await this.prisma.round_puzzles.findMany({
      where: { round_id: roundId, puzzles: { type: 'FINAL' } },
      orderBy: { order_number: 'asc' },
      include: { puzzles: true },
      take: 1,
    });
    return links[0] ? this._shape(links[0].puzzles, links[0]) : null;
  }

  /**
   * Count total puzzles assigned to a team in a round.
   * New schema shares puzzles — returns the round's puzzle count.
   */
  async countTeamPuzzles(roundId, teamId) {
    return this.countByRound(roundId);
  }

  /**
   * Create a new puzzle and attach it to a round.
   *
   * In the new schema, creating a round-scoped puzzle is a two-step operation:
   *   1. Insert into `puzzles` (the library)
   *   2. Insert into `round_puzzles` (the junction linking puzzle to round with order + score)
   * Both steps are wrapped in a transaction for atomicity.
   *
   * @param {Object} params
   * @param {string} params.roundId - Round UUID.
   * @param {string} [params.puzzleType] - Maps to `type` (default 'STANDARD').
   * @param {number} [params.orderInRound] - order_number in round_puzzles (auto-computed if absent).
   * @param {object|string} params.initialGrid - JSONB initial grid.
   * @param {object|string} params.solution - JSONB solution grid (maps to solution_grid).
   * @param {number} [params.points] - Score for this puzzle in this round (default 100).
   * @param {string} [params.letter] - Ignored (column removed).
   * @param {string} [params.difficulty] - Difficulty label.
   * @param {string} [params.teamId] - Ignored (no team_id on puzzles).
   */
  async create({ roundId, puzzleType, orderInRound, initialGrid, solution, points, letter, difficulty, teamId }) {
    const parsedInitial = typeof initialGrid === 'string' ? JSON.parse(initialGrid) : initialGrid;
    const parsedSolution = typeof solution === 'string' ? JSON.parse(solution) : solution;

    return this.prisma.$transaction(async (tx) => {
      const puzzle = await tx.puzzles.create({
        data: {
          type: puzzleType || 'STANDARD',
          initial_grid: parsedInitial,
          solution_grid: parsedSolution,
          difficulty: difficulty || null,
          score: points || 100,
        },
      });

      // Compute order_number if not provided.
      let order = orderInRound;
      if (order === undefined) {
        const existing = await tx.round_puzzles.count({ where: { round_id: roundId } });
        order = existing + 1;
      }

      await tx.round_puzzles.create({
        data: {
          round_id: roundId,
          puzzle_id: puzzle.id,
          order_number: order,
          score: points || 100,
        },
      });

      return puzzle;
    });
  }

  /**
   * Update the letter on a puzzle.
   * The `letter` column was removed in the new schema — this is now a no-op.
   */
  async updateLetter(id, letter) {
    // No-op: letter column removed.
  }

  /**
   * Update the score of a single puzzle (library-level).
   */
  async updatePoints(id, points) {
    await this.prisma.puzzles.update({
      where: { id },
      data: { score: points },
    });
  }

  /**
   * Update the score of all puzzles attached to a round (junction-level).
   */
  async updatePointsByRound(roundId, pointsPerPuzzle) {
    await this.prisma.round_puzzles.updateMany({
      where: { round_id: roundId },
      data: { score: pointsPerPuzzle },
    });
  }

  /**
   * Delete all puzzles attached to a round (junction links only).
   * The puzzle library rows are preserved (they may be shared across rounds).
   */
  async deleteByRound(roundId) {
    await this.prisma.round_puzzles.deleteMany({
      where: { round_id: roundId },
    });
  }

  /**
   * Delete a single puzzle from the library.
   * Round links are cascade-deleted via the FK constraint on round_puzzles.
   */
  async deleteById(id) {
    await this.prisma.puzzles.delete({ where: { id } });
  }

  /**
   * Delete all puzzles in the library.
   * Round links are cascade-deleted.
   */
  async clearAll() {
    await this.prisma.puzzles.deleteMany({});
  }

  /**
   * Delete all puzzles belonging to a given organization's rounds.
   * Traverses: rounds → competition_stages → competitions → organization_id.
   * Removes both junction links (round_puzzles) and the puzzle library rows.
   */
  async clearByOrganization(organizationId) {
    // Find all rounds belonging to this organization
    const rounds = await this.prisma.rounds.findMany({
      where: {
        competition_stages: {
          competitions: { organization_id: organizationId },
        },
      },
      select: { id: true },
    });
    const roundIds = rounds.map((r) => r.id);

    if (roundIds.length === 0) return;

    // Find puzzle IDs linked to those rounds
    const links = await this.prisma.round_puzzles.findMany({
      where: { round_id: { in: roundIds } },
      select: { puzzle_id: true },
    });
    const puzzleIds = [...new Set(links.map((l) => l.puzzle_id))];

    // Delete junction links first (FK constraint)
    await this.prisma.round_puzzles.deleteMany({
      where: { round_id: { in: roundIds } },
    });

    // Delete puzzle library rows (only if not referenced by other rounds)
    if (puzzleIds.length > 0) {
      await this.prisma.puzzles.deleteMany({
        where: {
          id: { in: puzzleIds },
          round_puzzles: { none: {} }, // only orphaned puzzles
        },
      });
    }
  }

  /**
   * Shape a puzzle + its round_puzzles link into the legacy row format
   * expected by route handlers.
   * @private
   */
  _shape(puzzle, link) {
    return {
      ...puzzle,
      puzzle_type: puzzle.type,
      initial_grid: puzzle.initial_grid,
      solution: puzzle.solution_grid, // legacy alias
      points: link?.score ?? puzzle.score,
      order_in_round: link?.order_number ?? null,
      letter: null, // column removed
      round_id: link?.round_id ?? null,
    };
  }
}

module.exports = PuzzleRepository;
