/**
 * RoundEngine — abstract base class for round-specific game logic.
 *
 * Each round type implements these methods. The return convention is:
 *   { result: any, emissions: Emission[] }
 *
 * An Emission is a plain object describing a socket event to emit:
 *   { target: 'tournament' | 'team' | 'user', targetId: number|null, event: string, payload: any }
 *
 * The GameOrchestrator processes emissions — RoundEngines never touch Socket.io directly.
 */

/** @typedef {{ target: 'tournament'|'team'|'user', targetId: number|null, event: string, payload: any }} Emission */

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
   * @param {number} tournamentId
   * @param {number} roundId
   * @param {Array} teams
   * @param {Array} puzzles
   * @returns {Promise<{ result: any, emissions: Emission[] }>}
   */
  async setup(tournamentId, roundId, teams, puzzles) {
    throw new Error('setup() must be implemented by subclass');
  }

  // ─── Submit answer ────────────────────────────────────────────

  /**
   * Handle a player's answer submission.
   * @param {number} userId
   * @param {number} tournamentId
   * @param {number} roundId
   * @param {number} puzzleId
   * @param {string} submissionType
   * @param {{ row?: number, col?: number, value?: number, grid?: number[][] }} data
   * @returns {Promise<{ result: any, emissions: Emission[] }>}
   */
  async submitAnswer(userId, tournamentId, roundId, puzzleId, submissionType, data) {
    throw new Error('submitAnswer() must be implemented by subclass');
  }

  // ─── Reconnect state ──────────────────────────────────────────

  /**
   * Return all state a reconnecting player needs to resume.
   * @param {number} userId
   * @param {number} tournamentId
   * @param {number} roundId
   * @returns {Promise<object|null>}
   */
  async getReconnectState(userId, tournamentId, roundId) {
    throw new Error('getReconnectState() must be implemented by subclass');
  }

  // ─── Cleanup ──────────────────────────────────────────────────

  /**
   * Called when a round ends. Clean up StateRepository entries.
   * @param {number} tournamentId
   * @param {number} roundId
   * @returns {Promise<void>}
   */
  async cleanup(tournamentId, roundId) {
    throw new Error('cleanup() must be implemented by subclass');
  }

  // ─── Helpers for building emissions ───────────────────────────

  _emitTournament(tournamentId, event, payload) {
    return { target: 'tournament', targetId: tournamentId, event, payload };
  }

  _emitTeam(tournamentId, teamId, event, payload) {
    return { target: 'team', targetId: { tournamentId, teamId }, event, payload };
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
