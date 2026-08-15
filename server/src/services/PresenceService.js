/**
 * PresenceService — periodic heartbeat monitor for participant online/offline status.
 *
 * Responsibilities:
 *   - Track which competitions to monitor (addCompetition/removeCompetition)
 *   - Periodically sweep active players to detect stale heartbeats
 *   - Remove stale players and emit PARTICIPANT_STATUS_CHANGE events
 *   - Provide getOnlinePlayers() wrapper for state.getActivePlayers()
 *
 * Architecture:
 *   - Runs setInterval every HEARTBEAT_INTERVAL_MS (30s)
 *   - For each monitored competition, calls state.getStalePlayers(competitionId, ACTIVE_PLAYER_TTL_MS)
 *   - Removes stale players via state.removeActivePlayer()
 *   - Emits PARTICIPANT_STATUS_CHANGE via EmissionBus for each offline player
 *
 * Lifecycle:
 *   - start() called once at server boot
 *   - stop() called on graceful shutdown (if needed)
 */

const config = require('../config');

class PresenceService {
  /**
   * @param {import('../state/StateRepository')} state
   * @param {import('../ws/EmissionBus')} bus
   */
  constructor(state, bus) {
    this.state = state;
    this.bus = bus;
    this.monitoredCompetitions = new Set();
    this.intervalHandle = null;
  }

  /**
   * Start the periodic sweep. Runs every HEARTBEAT_INTERVAL_MS (30s).
   * @param {number} [intervalMs] — override interval for tests
   * @param {number} [ttlMs] — override TTL for tests
   */
  start(intervalMs, ttlMs) {
    if (this.intervalHandle) return;

    this.intervalHandle = setInterval(async () => {
      await this.sweep(ttlMs);
    }, intervalMs || config.HEARTBEAT_INTERVAL_MS);

    // Prevent the interval from keeping the process alive during tests
    if (this.intervalHandle.unref) {
      this.intervalHandle.unref();
    }
  }

  /**
   * Stop the periodic sweep.
   */
  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Add a competition to the monitoring set.
   * @param {string} competitionId
   */
  addCompetition(competitionId) {
    this.monitoredCompetitions.add(competitionId);
  }

  /**
   * Remove a competition from the monitoring set.
   * @param {string} competitionId
   */
  removeCompetition(competitionId) {
    this.monitoredCompetitions.delete(competitionId);
  }

  /**
   * Get online players for a competition (wrapper around state.getActivePlayers).
   * @param {string} competitionId
   * @returns {Promise<Object<string, {socketId: string, lastHeartbeatAt: number}>>}
   */
  async getOnlinePlayers(competitionId) {
    return await this.state.getActivePlayers(competitionId);
  }

  /**
   * Sweep all monitored competitions for stale heartbeats.
   * Called automatically by the interval, but can also be called manually in tests.
   * @param {number} [ttlMs] — override TTL for tests (defaults to config.ACTIVE_PLAYER_TTL_S * 1000)
   */
  async sweep(ttlMs) {
    const effectiveTtl = ttlMs || (config.ACTIVE_PLAYER_TTL_S * 1000);

    for (const competitionId of this.monitoredCompetitions) {
      try {
        const stalePlayers = await this.state.getStalePlayers(competitionId, effectiveTtl);

        for (const { userId, socketId } of stalePlayers) {
          // Remove the stale player from active tracking
          await this.state.removeActivePlayer(competitionId, userId);

          // Emit offline status change event
          this.bus.emitImmediate({
            target: 'competition',
            targetId: competitionId,
            event: 'PARTICIPANT_STATUS_CHANGE',
            payload: {
              competitionId,
              userId,
              status: 'offline',
              socketId
            }
          });
        }
      } catch (err) {
        // Log but don't crash — one bad competition shouldn't break the sweep
        console.error(`[PresenceService] sweep error for competition ${competitionId}:`, err.message);
      }
    }
  }
}

module.exports = PresenceService;
