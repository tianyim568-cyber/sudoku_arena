/**
 * RoundEngine — abstract base class for round-specific game logic.
 *
 * Each round type implements these methods. The return convention is:
 *   { result: any, emissions: Emission[] }
 *
 * An Emission is a plain object describing a socket event to emit:
 *   { target: 'competition' | 'team' | 'user', targetId: number|null, event: string, payload: any }
 *
 * The GameOrchestrator processes emissions — RoundEngines never touch Socket.io directly.
 */

/** @typedef {{ target: 'competition'|'team'|'user', targetId: number|null, event: string, payload: any }} Emission */

class RoundEngine {
  /**
   * @param {import('../db/index')} repos — repository factory
   * @param {import('../state/StateRepository')} state — StateRepository (Memory or Redis)
   * @param {import('./ScoringService')} scoring
   */
  constructor(repos, state, scoring) {
    this.repos = repos;
    this.state = state;
    this.scoring = scoring;

    if (new.target === RoundEngine) {
      throw new Error('RoundEngine is abstract and cannot be instantiated directly');
    }
  }

  // ─── Setup ────────────────────────────────────────────────────

  /**
   * Called when a round starts. Distribute puzzles, initialize state.
   * @param {number} competitionId
   * @param {number} roundId
   * @param {Array} teams
   * @param {Array} puzzles
   * @returns {Promise<{ result: any, emissions: Emission[] }>}
   */
  async setup(competitionId, roundId, teams, puzzles) {
    throw new Error('setup() must be implemented by subclass');
  }

  // ─── Submit answer ────────────────────────────────────────────

  /**
   * Handle a player's answer submission.
   * @param {number} userId
   * @param {number} competitionId
   * @param {number} roundId
   * @param {number} puzzleId
   * @param {string} submissionType
   * @param {{ row?: number, col?: number, value?: number, grid?: number[][] }} data
   * @returns {Promise<{ result: any, emissions: Emission[] }>}
   */
  async submitAnswer(userId, competitionId, roundId, puzzleId, submissionType, data) {
    throw new Error('submitAnswer() must be implemented by subclass');
  }

  // ─── Reconnect state ──────────────────────────────────────────

  /**
   * Return all state a reconnecting player needs to resume.
   * @param {number} userId
   * @param {number} competitionId
   * @param {number} roundId
   * @returns {Promise<object|null>}
   */
  async getReconnectState(userId, competitionId, roundId) {
    throw new Error('getReconnectState() must be implemented by subclass');
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  /**
   * Called when a round ends. Clean up StateRepository entries.
   * @param {number} competitionId
   * @param {number} roundId
   * @returns {Promise<void>}
   */
  async cleanup(competitionId, roundId) {
    throw new Error('cleanup() must be implemented by subclass');
  }

  // ─── Helpers for building emissions ───────────────────────────

  _emitCompetition(competitionId, event, payload) {
    return { target: 'competition', targetId: competitionId, event, payload };
  }

  _emitTeam(competitionId, teamId, event, payload) {
    return { target: 'team', targetId: { competitionId, teamId }, event, payload };
  }

  _emitUser(userId, event, payload) {
    return { target: 'user', targetId: userId, event, payload };
  }

  // ─── Grid validation ──────────────────────────────────────────

  _validateFullGrid(grid, solution) {
    if (!grid || !solution) return false;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (grid[r]?.[c] !== solution[r]?.[c]) return false;
      }
    }
    return true;
  }
}

module.exports = RoundEngine;
