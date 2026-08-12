/**
 * RankingRepository — category-scoped ranking queries.
 *
 * Provides methods to fetch rankings filtered by category, supporting
 * the category ranking feature (U6/U8/U12 age groups).
 */

const { getPrisma } = require('../prisma');

class RankingRepository {
  constructor() {
    this.prisma = getPrisma();
  }

  /**
   * Get round rankings filtered by category.
   * @param {string} roundId
   * @param {string|null} categoryId - null returns all rankings
   * @returns {Promise<Array>} rankings with player info
   */
  async getRoundRankings(roundId, categoryId = null) {
    const where = { round_id: roundId };
    if (categoryId) {
      where.category_id = categoryId;
    }

    return this.prisma.round_rankings.findMany({
      where,
      orderBy: { rank: 'asc' },
      include: {
        players: {
          select: {
            id: true,
            name: true,
            school: true,
            age: true,
            categories: {
              select: { id: true, name: true, min_age: true, max_age: true },
            },
          },
        },
      },
    });
  }

  /**
   * Get final rankings filtered by category.
   * @param {string} competitionStageId
   * @param {string|null} categoryId
   * @returns {Promise<Array>} final rankings
   */
  async getFinalRankings(competitionStageId, categoryId = null) {
    const where = { competition_stage_id: competitionStageId };
    if (categoryId) {
      where.category_id = categoryId;
    }

    return this.prisma.final_rankings.findMany({
      where,
      orderBy: { rank: 'asc' },
      include: {
        players: {
          select: {
            id: true,
            name: true,
            school: true,
            age: true,
            categories: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });
  }

  /**
   * Get all categories for a competition.
   * @returns {Promise<Array>} categories
   */
  async getAllCategories() {
    return this.prisma.categories.findMany({
      orderBy: { min_age: 'asc' },
    });
  }

  /**
   * Count players in a category for a round.
   * @param {string} roundId
   * @param {string} categoryId
   * @returns {Promise<number>}
   */
  async countPlayersInCategory(roundId, categoryId) {
    return this.prisma.round_rankings.count({
      where: {
        round_id: roundId,
        category_id: categoryId,
      },
    });
  }
}

module.exports = { RankingRepository };
