/**
 * Round2NotificationService — 5-second pre-rotation notification.
 *
 * Manages parallel timeouts that fire 5 seconds before each rotation,
 * emitting a ROUND2_ROTATION_WARNING to the team.
 * Does NOT replace the existing rotation interval mechanism.
 *
 * Follows SRP: only handles notification scheduling and cleanup.
 */

class Round2NotificationService {
  constructor() {
    // roundId:teamId -> timeoutId
    this._notificationTimeouts = new Map();
  }

  // ─── Schedule notification ─────────────────────────────────────

  /**
   * Schedule a 5-second pre-rotation warning for a team.
   *
   * @param {number} tournamentId
   * @param {number} roundId
   * @param {number} teamId
   * @param {number} nextRotationAt - Unix ms when rotation occurs
   * @param {Function} onNotify - callback(tournamentId, roundId, teamId) when warning fires
   */
  scheduleRotationNotification(tournamentId, roundId, teamId, nextRotationAt, onNotify) {
    // Clear any existing notification for this team
    this._clearTeamNotification(roundId, teamId);

    if (!nextRotationAt) return;

    const now = Date.now();
    const warningAt = nextRotationAt - 5000; // 5 seconds before rotation

    let delay = warningAt - now;
    if (delay < 0) delay = 0; // Already past the warning time, fire immediately
    if (delay > 60000) delay = 60000; // Cap at 60s (shouldn't happen normally)

    const key = `${roundId}:${teamId}`;
    const timeoutId = setTimeout(() => {
      this._notificationTimeouts.delete(key);
      onNotify(tournamentId, roundId, teamId);
    }, delay);

    this._notificationTimeouts.set(key, timeoutId);
  }

  // ─── Clear notifications ───────────────────────────────────────

  /**
   * Clear all notification timeouts for a round's teams.
   * @param {number} roundId
   * @param {Array} teams - team objects with id property
   */
  clearNotifications(roundId, teams) {
    for (const team of teams) {
      this._clearTeamNotification(roundId, team.id);
    }
  }

  /**
   * Clear all notification timeouts.
   */
  clearAllNotifications() {
    for (const [, timeoutId] of this._notificationTimeouts) {
      clearTimeout(timeoutId);
    }
    this._notificationTimeouts.clear();
  }

  // ─── Internal ──────────────────────────────────────────────────

  _clearTeamNotification(roundId, teamId) {
    const key = `${roundId}:${teamId}`;
    const timeoutId = this._notificationTimeouts.get(key);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this._notificationTimeouts.delete(key);
    }
  }
}

module.exports = Round2NotificationService;
