/**
 * DisplayManager — big-screen display token management and ranking snapshots.
 *
 * Responsibilities:
 *   - Generate/verify/revoke display access tokens for competitions
 *   - Build ranking snapshots for display (with category filtering)
 *   - Emit RANKING_UPDATE events to display WebSocket room
 *
 * Display tokens are stored on the competition record (display_access_token field)
 * and allow unauthenticated access to public ranking data.
 */

const crypto = require('crypto');
const { getPrisma } = require('../db/prisma');

class DisplayManager {
  /**
   * @param {import('../db/index')} repos
   * @param {import('./EmissionBus')} bus
   */
  constructor(repos, bus) {
    this.repos = repos;
    this.bus = bus;
  }

  // ─── Token Management ──────────────────────────────────────────

  /**
   * Generate a new display access token for a competition.
   * Replaces any existing token.
   * @param {string} competitionId
   * @returns {Promise<string>} The new token
   */
  async generateToken(competitionId) {
    const token = this._generateSecureToken();
    const prisma = getPrisma();

    await prisma.competitions.update({
      where: { id: competitionId },
      data: { display_access_token: token },
    });

    return token;
  }

  /**
   * Verify a display access token and return the competition ID.
   * @param {string} token
   * @returns {Promise<string|null>} competitionId or null if invalid
   */
  async verifyToken(token) {
    if (!token) return null;

    const prisma = getPrisma();
    const competition = await prisma.competitions.findFirst({
      where: { display_access_token: token },
      select: { id: true, status: true },
    });

    return competition?.id || null;
  }

  /**
   * Revoke the display access token for a competition.
   * @param {string} competitionId
   * @returns {Promise<void>}
   */
  async revokeToken(competitionId) {
    const prisma = getPrisma();
    await prisma.competitions.update({
      where: { id: competitionId },
      data: { display_access_token: null },
    });
  }

  // ─── Ranking Snapshots ─────────────────────────────────────────

  /**
   * Build a ranking snapshot for a competition (optionally filtered by category).
   * @param {string} competitionId
   * @param {string|null} categoryId — filter by category, or null for all
   * @returns {Promise<object>} Ranking snapshot with stages, rounds, and rankings
   */
  async getRankingSnapshot(competitionId, categoryId = null) {
    const prisma = getPrisma();

    // Get competition info
    const competition = await prisma.competitions.findUnique({
      where: { id: competitionId },
      select: {
        id: true,
        name: true,
        status: true,
        competition_stages: {
          orderBy: { order_number: 'asc' },
          select: {
            id: true,
            type: true,
            order_number: true,
            status: true,
            rounds: {
              orderBy: { order_number: 'asc' },
              select: {
                id: true,
                name: true,
                order_number: true,
                status: true,
                round_rankings: {
                  where: categoryId ? { players: { category_id: categoryId } } : {},
                  orderBy: { rank: 'asc' },
                  select: {
                    rank: true,
                    score: true,
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
                },
              },
            },
          },
        },
      },
    });

    if (!competition) {
      throw new Error('Competition not found');
    }

    // Build final rankings (from final_rankings table if available)
    const finalRankings = await prisma.final_rankings.findMany({
      where: {
        competition_stage_id: {
          in: competition.competition_stages.map(s => s.id),
        },
        ...(categoryId ? { category_id: categoryId } : {}),
      },
      orderBy: [{ competition_stage_id: 'asc' }, { rank: 'asc' }],
      select: {
        competition_stage_id: true,
        category_id: true,
        entity_type: true,
        entity_id: true,
        rank: true,
        score: true,
      },
    });

    // Get categories for filtering UI
    const categories = await prisma.categories.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, min_age: true, max_age: true },
    });

    return {
      competition: {
        id: competition.id,
        name: competition.name,
        status: competition.status,
      },
      categories,
      stages: competition.competition_stages.map(stage => ({
        id: stage.id,
        type: stage.type,
        orderNumber: stage.order_number,
        status: stage.status,
        rounds: stage.rounds.map(round => ({
          id: round.id,
          name: round.name,
          orderNumber: round.order_number,
          status: round.status,
          rankings: round.round_rankings.map(r => ({
            rank: r.rank,
            totalScore: r.score,
            player: r.players ? {
              id: r.players.id,
              name: r.players.name,
              school: r.players.school,
              age: r.players.age,
              category: r.players.categories,
            } : null,
          })),
        })),
      })),
      finalRankings: finalRankings.map(fr => ({
        stageId: fr.competition_stage_id,
        categoryId: fr.category_id,
        entityType: fr.entity_type,
        entityId: fr.entity_id,
        rank: fr.rank,
        score: fr.score,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Emit a RANKING_UPDATE event to the display WebSocket room.
   * Call this after round ends, score changes, or ranking updates.
   * @param {string} competitionId
   * @param {string|null} categoryId
   */
  async emitRankingUpdate(competitionId, categoryId = null) {
    try {
      const snapshot = await this.getRankingSnapshot(competitionId, categoryId);
      this.bus.emitImmediate({
        target: 'display',
        targetId: competitionId,
        event: 'RANKING_UPDATE',
        payload: {
          categoryId,
          snapshot,
        },
      });
    } catch (e) {
      console.error('[DisplayManager] emitRankingUpdate error:', e.message);
    }
  }

  // ─── Private helpers ───────────────────────────────────────────

  /**
   * Generate a cryptographically secure 32-character token.
   * @returns {string}
   */
  _generateSecureToken() {
    return crypto.randomBytes(24).toString('hex');
  }
}

module.exports = DisplayManager;
