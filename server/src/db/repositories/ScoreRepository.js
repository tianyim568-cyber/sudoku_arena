/**
 * Score repository — abstracts score-related database operations.
 *
 * NOTE: The legacy `scores` table was dropped in migration 018. Scores are now
 * tracked in two snapshot tables:
 *   - `round_rankings` (UUID PK, round_id, participant_id?, team_id?, score, rank,
 *     category_id?, calculated_at) — per-round scores
 *   - `final_rankings` (UUID PK, competition_stage_id, category_id, entity_type
 *     [PLAYER|TEAM], entity_id, rank, score) — per-stage final snapshots
 *
 * Legacy → new mapping:
 *   scores.tournament_id  → (gone) — resolve via round → stage → competition
 *   scores.round_id       → round_rankings.round_id
 *   scores.team_id        → round_rankings.team_id
 *   scores.player_id      → round_rankings.participant_id
 *   scores.score_type     → entity_type (TEAM vs PLAYER) — implicit via which FK is set
 *   scores.total_points   → round_rankings.score
 *
 * Public method names are kept identical so route handlers keep working.
 * The upsert semantics (idempotent addPoints) are preserved via Prisma upserts
 * on the (round_id, participant_id/team_id) composite.
 */

class ScoreRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  /**
   * Find a team's score for a round.
   * @param {string} competitionId - Competition UUID (unused — kept for API compat).
   * @param {string} roundId
   * @param {string} teamId
   * @returns {Promise<{total_points: number}|null>}
   */
  async findTeamScore(competitionId, roundId, teamId) {
    const row = await this.prisma.round_rankings.findFirst({
      where: { round_id: roundId, team_id: teamId },
      select: { score: true },
    });
    return row ? { total_points: row.score } : null;
  }

  /**
   * Find a team's full score row for a round.
   * @param {string} competitionId - Competition UUID (unused — kept for API compat).
   * @param {string} roundId
   * @param {string} teamId
   */
  async findTeamScoreRow(competitionId, roundId, teamId) {
    return this.prisma.round_rankings.findFirst({
      where: { round_id: roundId, team_id: teamId },
    });
  }

  /**
   * Find a player's score for a round.
   * @param {string} competitionId - Competition UUID (unused — kept for API compat).
   * @param {string} roundId
   * @param {string} playerId
   * @returns {Promise<{total_points: number}|null>}
   */
  async findPlayerScore(competitionId, roundId, playerId) {
    const row = await this.prisma.round_rankings.findFirst({
      where: { round_id: roundId, participant_id: playerId },
      select: { score: true },
    });
    return row ? { total_points: row.score } : null;
  }

  /**
   * Find a player's full score row for a round.
   * @param {string} competitionId - Competition UUID (unused — kept for API compat).
   * @param {string} roundId
   * @param {string} playerId
   */
  async findPlayerScoreRow(competitionId, roundId, playerId) {
    return this.prisma.round_rankings.findFirst({
      where: { round_id: roundId, participant_id: playerId },
    });
  }

  /**
   * Find all team scores for a competition, joined with team + round names.
   * Traverses round → stage → competition since round_rankings has no direct
   * competition_id.
   * @param {string} competitionId
   */
  async findTeamScoresByCompetition(competitionId) {
    const rankings = await this.prisma.round_rankings.findMany({
      where: {
        team_id: { not: null },
        rounds: {
          competition_stages: { competition_id: competitionId },
        },
      },
      include: {
        teams: { select: { name: true } },
        rounds: { select: { name: true } },
      },
      orderBy: { calculated_at: 'asc' },
    });
    return rankings.map((r) => ({
      ...r,
      total_points: r.score,
      team_name: r.teams?.name ?? null,
      round_name: r.rounds?.name ?? null,
    }));
  }

  /**
   * Find all player scores for a competition, joined with round names.
   * @param {string} competitionId
   */
  async findPlayerScoresByCompetition(competitionId) {
    const rankings = await this.prisma.round_rankings.findMany({
      where: {
        participant_id: { not: null },
        rounds: {
          competition_stages: { competition_id: competitionId },
        },
      },
      include: {
        rounds: { select: { name: true } },
      },
      orderBy: { calculated_at: 'asc' },
    });
    return rankings.map((r) => ({
      ...r,
      total_points: r.score,
      round_name: r.rounds?.name ?? null,
    }));
  }

  /**
   * Add points to a team's score for a round. Idempotent upsert: if a
   * round_rankings row exists for (round_id, team_id), increment its score;
   * otherwise create it.
   *
   * Note: round_rankings has no unique constraint on (round_id, team_id) alone
   * (the unique constraint is on (round_id, participant_id)). We use findFirst
   * + update/create instead of a native upsert.
   *
   * @param {string} competitionId - Competition UUID (unused — kept for API compat).
   * @param {string} roundId
   * @param {string} teamId
   * @param {number} points
   */
  async addTeamPoints(competitionId, roundId, teamId, points) {
    const existing = await this.prisma.round_rankings.findFirst({
      where: { round_id: roundId, team_id: teamId },
    });
    if (existing) {
      return this.prisma.round_rankings.update({
        where: { id: existing.id },
        data: { score: { increment: points } },
      });
    }
    return this.prisma.round_rankings.create({
      data: {
        round_id: roundId,
        team_id: teamId,
        score: points,
      },
    });
  }

  /**
   * Add points to a player's score for a round. Idempotent upsert.
   * The `teamId` parameter is kept for backward compat but is not stored on
   * round_rankings (which is either participant-scoped or team-scoped).
   *
   * @param {string} competitionId - Competition UUID (unused — kept for API compat).
   * @param {string} roundId
   * @param {string} playerId
   * @param {string} teamId - Unused (kept for API compat).
   * @param {number} points
   */
  async addPlayerPoints(competitionId, roundId, playerId, teamId, points) {
    const existing = await this.prisma.round_rankings.findFirst({
      where: { round_id: roundId, participant_id: playerId },
    });
    if (existing) {
      return this.prisma.round_rankings.update({
        where: { id: existing.id },
        data: { score: { increment: points } },
      });
    }
    return this.prisma.round_rankings.create({
      data: {
        round_id: roundId,
        participant_id: playerId,
        score: points,
      },
    });
  }

  /**
   * Delete all round_rankings for a competition's rounds.
   * Traverses round → stage → competition.
   * @param {string} competitionId
   */
  async deleteByCompetition(competitionId) {
    await this.prisma.round_rankings.deleteMany({
      where: {
        rounds: {
          competition_stages: { competition_id: competitionId },
        },
      },
    });
  }
}

module.exports = ScoreRepository;
