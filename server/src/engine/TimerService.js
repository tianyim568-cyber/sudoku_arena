/**
 * TimerService — manages round timers via StateRepository.
 *
 * Timer model: server-authoritative timestamps
 *   - `turnEndsAt` (Unix ms) replaces countdown integers
 *   - Client computes `remaining = max(0, turnEndsAt - Date.now())` locally
 *   - Pause stores `remainingAtPause`; resume recalculates `turnEndsAt`
 *
 * Holds only interval IDs in memory — NOT game state.
 */

class TimerService {
  /**
   * @param {import('../state/StateRepository')} state
   */
  constructor(state) {
    this.state = state;
    /** @type {Map<number, NodeJS.Timeout>} roundId → intervalId */
    this._intervals = new Map();
  }

  // ─── Start a round timer ──────────────────────────────────────

  /**
   * Initialize and start a round timer.
   * @param {number} roundId
   * @param {number} durationSeconds
   * @returns {{ turnEndsAt: number, durationSeconds: number }}
   */
  async start(roundId, durationSeconds) {
    const turnEndsAt = Date.now() + durationSeconds * 1000;
    await this.state.setRoundTimer(roundId, {
      turnEndsAt,
      durationSeconds,
      status: 'RUNNING'
    });
    return { turnEndsAt, durationSeconds };
  }

  // ─── Pause ────────────────────────────────────────────────────

  /**
   * Pause the timer for a round. Saves remaining ms.
   * @param {number} roundId
   * @returns {number} remainingSeconds at pause time
   */
  async pause(roundId) {
    const remaining = await this.state.getRemainingSeconds(roundId);
    const timerState = await this.state.getRoundTimer(roundId);
    if (timerState) {
      await this.state.setRoundTimer(roundId, {
        ...timerState,
        status: 'PAUSED',
        pausedAt: Date.now(),
        remainingAtPause: remaining * 1000 // ms
      });
    }
    return remaining;
  }

  // ─── Resume ───────────────────────────────────────────────────

  /**
   * Resume a paused timer. Recalculates turnEndsAt from remaining ms.
   * @param {number} roundId
   * @returns {{ turnEndsAt: number, durationSeconds: number } | null}
   */
  async resume(roundId) {
    const timerState = await this.state.getRoundTimer(roundId);
    if (!timerState) return null;

    const remainingMs = timerState.remainingAtPause || 0;
    const turnEndsAt = Date.now() + remainingMs;
    const durationSeconds = timerState.durationSeconds || 0;

    await this.state.setRoundTimer(roundId, {
      turnEndsAt,
      durationSeconds,
      status: 'RUNNING',
      pausedAt: null,
      remainingAtPause: null
    });

    return { turnEndsAt, durationSeconds };
  }

  // ─── Query ────────────────────────────────────────────────────

  /**
   * Get remaining seconds for a round (computed from turnEndsAt or remainingAtPause).
   * @param {number} roundId
   * @returns {Promise<number>}
   */
  async getRemainingSeconds(roundId) {
    return this.state.getRemainingSeconds(roundId);
  }

  /**
   * Get the full timer state object.
   * @param {number} roundId
   * @returns {Promise<object|null>}
   */
  async getTimerState(roundId) {
    return this.state.getRoundTimer(roundId);
  }

  // ─── Tick interval management ─────────────────────────────────

  /**
   * Start a 1-second tick interval. Calls `onTick(remaining, timerState, shouldBroadcast)`.
   * Broadcasts every 10th tick (~10s) for client recalibration; client interpolates
   * locally from turnEndsAt between broadcasts.
   * If remaining <= 0, calls `onExpire()` and clears the interval.
   * @param {number} roundId
   * @param {number} durationSeconds
   * @param {(remaining: number, timerState: object, shouldBroadcast: boolean) => void} onTick
   * @param {() => void} onExpire
   */
  startTickInterval(roundId, durationSeconds, onTick, onExpire) {
    let tickCount = 0;
    const interval = setInterval(async () => {
      const remaining = await this.state.getRemainingSeconds(roundId);
      if (remaining <= 0) {
        this.clearTickInterval(roundId);
        onExpire();
        return;
      }
      tickCount++;
      const timerState = await this.state.getRoundTimer(roundId);
      // Broadcast every 10th tick (~every 10s) for recalibration
      const shouldBroadcast = tickCount % 10 === 1; // 1st, 11th, 21st...
      onTick(remaining, timerState, shouldBroadcast);
    }, 1000);
    this._intervals.set(roundId, interval);
  }

  /**
   * Clear a tick interval.
   * @param {number} roundId
   */
  clearTickInterval(roundId) {
    const interval = this._intervals.get(roundId);
    if (interval) {
      clearInterval(interval);
      this._intervals.delete(roundId);
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  /**
   * Remove all timer state for a round (call on round end).
   * @param {number} roundId
   */
  async cleanup(roundId) {
    this.clearTickInterval(roundId);
    await this.state.deleteRoundTimer(roundId);
  }
}

module.exports = TimerService;
