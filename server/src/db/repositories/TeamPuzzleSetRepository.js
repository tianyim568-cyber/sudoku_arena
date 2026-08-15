/**
 * TeamPuzzleSetRepository — abstracts team-puzzle assignment per round.
 *
 * NOTE: The legacy `team_puzzle_sets` table was dropped in migration 018.
 * The new schema replaces it with the `round_puzzles` junction table for
 * puzzle-to-round assignment. Team-specific puzzle sets are no longer modeled
 * — all puzzles in a round are shared across teams.
 *
 * Legacy → new mapping:
 *   team_puzzle_sets.tournament_id → (gone)
 *   team_puzzle_sets.round_id      → round_puzzles.round_id
 *   team_puzzle_sets.team_id       → (gone — puzzles are shared across teams)
 *   team_puzzle_sets.word          → (gone — no equivalent; was a team mnemonic)
 *   team_puzzle_sets.puzzle_ids    → (gone — replaced by one round_puzzles row per puzzle)
 *
 * Public method names are kept identical so route handlers keep working.
 * Where a method's semantics no longer have a target (e.g. team-specific puzzle
 * sets), it returns a sensible empty/null result with a clear comment.
 */

class TeamPuzzleSetRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Persist a team-puzzle assignment.
   *
   * The new schema has no team-specific puzzle assignment — puzzles are shared
   * across all teams in a round. This method is kept for backward compat with
   * the PuzzleAssignmentService flow: it parses the comma-separated puzzle_ids
   * and ensures each is linked to the round via `round_puzzles` (idempotent).
   *
   * The `competitionId` and `word` parameters are accepted but not persisted.
   *
   * @param {string} competitionId - Ignored (no competition_id on round_puzzles).
   * @param {string} roundId
   * @param {string} teamId - Ignored (puzzles are shared across teams).
   * @param {string} word - Ignored (no word column in new schema).
   * @param {string} puzzleIds - Comma-separated puzzle UUIDs.
   */
  async persist(competitionId, roundId, teamId, word, puzzleIds) {
    if (!puzzleIds) return;
    const ids = String(puzzleIds)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) return;

    for (let i = 0; i < ids.length; i++) {
      const puzzleId = ids[i];
      await this.prisma.round_puzzles.upsert({
        where: {
          round_puzzles_round_puzzle_unique: {
            round_id: roundId,
            puzzle_id: puzzleId,
          },
        },
        create: {
          round_id: roundId,
          puzzle_id: puzzleId,
          order_number: i + 1,
        },
        update: {
          order_number: i + 1,
        },
      });
    }
  }

  /**
   * Load all assignments for a round.
   *
   * The new schema has no team_id on round_puzzles. This method returns the
   * round's puzzle links reshaped to the legacy { team_id, word, puzzle_ids }
   * format, with team_id = null and word = null (since neither concept exists).
   * @returns {Promise<Array<{team_id: null, word: null, puzzle_ids: string}>>}
   */
  async loadByRound(roundId) {
    const links = await this.prisma.round_puzzles.findMany({
      where: { round_id: roundId },
      orderBy: { order_number: 'asc' },
      select: { puzzle_id: true },
    });
    if (links.length === 0) return [];
    return [
      {
        team_id: null,
        word: null,
        puzzle_ids: links.map((l) => l.puzzle_id).join(','),
      },
    ];
  }

  /**
   * Get puzzle IDs for a team in a round.
   *
   * The new schema shares puzzles across teams, so this returns the same
   * comma-separated list regardless of teamId.
   * @returns {Promise<string|null>} comma-separated puzzle UUIDs, or null.
   */
  async getByTeam(roundId, teamId) {
    const rows = await this.prisma.round_puzzles.findMany({
      where: { round_id: roundId },
      orderBy: { order_number: 'asc' },
      select: { puzzle_id: true },
    });
    if (rows.length === 0) return null;
    return rows.map((r) => r.puzzle_id).join(',');
  }

  /**
   * Get the word for a team in a round.
   *
   * The `word` column was removed in the new schema. Always returns null.
   * @returns {Promise<null>}
   */
  async getWord(roundId, teamId) {
    return null;
  }

  /**
   * Reset all assignments for a round.
   *
   * Deletes all round_puzzles links for the round. Affects all teams (since
   * puzzles are shared), not just one team — callers should be aware of this
   * semantic change from the legacy behavior.
   */
  async resetByRound(roundId) {
    await this.prisma.round_puzzles.deleteMany({
      where: { round_id: roundId },
    });
  }
}

module.exports = TeamPuzzleSetRepository;
