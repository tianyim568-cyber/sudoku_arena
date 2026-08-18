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

    this.bus.emitImmediate({
      target: 'display',
      targetId: competitionId,
      event: 'DISPLAY_TOKEN_REVOKED',
      payload: { message: '显示令牌已被撤销' },
    });
  }

  /**
   * Set the display mode for a competition and emit change event.
   * @param {string} competitionId
   * @param {string} mode - One of DisplayMode values
   * @returns {Promise<void>}
   */
  async setDisplayMode(competitionId, mode) {
    const prisma = getPrisma();

    await prisma.competitions.update({
      where: { id: competitionId },
      data: { display_mode: mode },
    });

    this.bus.emitImmediate({
      target: 'display',
      targetId: competitionId,
      event: 'DISPLAY_MODE_CHANGED',
      payload: { mode, competitionId },
    });
  }

  /**
   * Broadcast a specific player's gameplay to the big-screen display.
   * Switches display mode to PLAYER_BROADCAST and emits player data.
   * @param {string} competitionId
   * @param {string} playerId
   * @returns {Promise<object>} Player data that was broadcast
   */
  async broadcastPlayer(competitionId, playerId) {
    const prisma = getPrisma();

    // Fetch player and verify they belong to this competition
    const player = await prisma.players.findFirst({
      where: {
        id: playerId,
        competition_id: competitionId,
      },
      select: {
        id: true,
        name: true,
        school: true,
        province: true,
        age: true,
        categories: {
          select: { id: true, name: true, min_age: true, max_age: true },
        },
      },
    });

    if (!player) {
      throw new Error('选手不存在或不属于此竞赛');
    }

    // Switch display mode to PLAYER_BROADCAST
    await prisma.competitions.update({
      where: { id: competitionId },
      data: {
        display_mode: 'PLAYER_BROADCAST',
        broadcast_player_id: player.id,
      },
    });

    // Emit broadcast event with player data
    const playerData = {
      id: player.id,
      name: player.name,
      school: player.school,
      province: player.province,
      age: player.age,
      category: player.categories,
    };

    this.bus.emitImmediate({
      target: 'display',
      targetId: competitionId,
      event: 'DISPLAY_PLAYER_BROADCAST',
      payload: {
        mode: 'PLAYER_BROADCAST',
        player: playerData,
        competitionId,
      },
    });

    return playerData;
  }

  /**
   * Stop broadcasting a player and return to DEFAULT display mode.
   * @param {string} competitionId
   * @returns {Promise<void>}
   */
  async stopBroadcast(competitionId) {
    const prisma = getPrisma();

    await prisma.competitions.update({
      where: { id: competitionId },
      data: {
        display_mode: 'DEFAULT',
        broadcast_player_id: null,
      },
    });

    this.bus.emitImmediate({
      target: 'display',
      targetId: competitionId,
      event: 'DISPLAY_MODE_CHANGED',
      payload: {
        mode: 'DEFAULT',
        competitionId,
      },
    });
  }

  /**
   * Get the current display mode for a competition.
   * @param {string} competitionId
   * @returns {Promise<string>} The current display mode (defaults to 'DEFAULT')
   */
  async getDisplayMode(competitionId) {
    const prisma = getPrisma();
    const competition = await prisma.competitions.findUnique({
      where: { id: competitionId },
      select: { display_mode: true },
    });

    return competition?.display_mode || 'DEFAULT';
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
        display_mode: true,
        broadcast_player_id: true,
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

    // If broadcasting a player, fetch their details for polling recovery
    let broadcastPlayer = null;
    if (competition.display_mode === 'PLAYER_BROADCAST' && competition.broadcast_player_id) {
      const bp = await prisma.players.findUnique({
        where: { id: competition.broadcast_player_id },
        select: {
          id: true,
          name: true,
          school: true,
          province: true,
          age: true,
          categories: {
            select: { id: true, name: true, min_age: true, max_age: true },
          },
        },
      });
      if (bp) {
        broadcastPlayer = {
          id: bp.id,
          name: bp.name,
          school: bp.school,
          province: bp.province,
          age: bp.age,
          category: bp.categories,
        };
      }
    }

    return {
      competition: {
        id: competition.id,
        name: competition.name,
        status: competition.status,
        displayMode: competition.display_mode || 'DEFAULT',
      },
      broadcastPlayer,
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

  // ─── Ranking Mode Emitters ────────────────────────────────────

  /**
   * Emit ROUND_RANKING mode: switch display mode and push updated snapshot.
   * Called after a round finishes to show per-round rankings on big screen.
   * @param {string} competitionId
   * @param {string|null} categoryId
   */
  async emitRoundRanking(competitionId, categoryId = null) {
    try {
      await this.setDisplayMode(competitionId, 'ROUND_RANKING');
      await this.emitRankingUpdate(competitionId, categoryId);
    } catch (e) {
      console.error('[DisplayManager] emitRoundRanking error:', e.message);
    }
  }

  /**
   * Emit STAGE_RANKING mode: switch display mode and push updated snapshot.
   * Called after a stage finishes to show aggregated stage rankings.
   * @param {string} competitionId
   * @param {string|null} categoryId
   */
  async emitStageRanking(competitionId, categoryId = null) {
    try {
      await this.setDisplayMode(competitionId, 'STAGE_RANKING');
      await this.emitRankingUpdate(competitionId, categoryId);
    } catch (e) {
      console.error('[DisplayManager] emitStageRanking error:', e.message);
    }
  }

  /**
   * Emit FINAL_RANKING mode: switch display mode and push final snapshot.
   * Called after the competition ends to show final results.
   * @param {string} competitionId
   * @param {string|null} categoryId
   */
  async emitFinalRanking(competitionId, categoryId = null) {
    try {
      await this.setDisplayMode(competitionId, 'FINAL_RANKING');
      await this.emitRankingUpdate(competitionId, categoryId);
    } catch (e) {
      console.error('[DisplayManager] emitFinalRanking error:', e.message);
    }
  }

  /**
   * Emit LIVE_RANKING mode: switch to live ranking during active rounds.
   * @param {string} competitionId
   * @param {string|null} categoryId
   */
  async emitLiveRanking(competitionId, categoryId = null) {
    try {
      await this.setDisplayMode(competitionId, 'LIVE_RANKING');
      await this.emitRankingUpdate(competitionId, categoryId);
    } catch (e) {
      console.error('[DisplayManager] emitLiveRanking error:', e.message);
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
