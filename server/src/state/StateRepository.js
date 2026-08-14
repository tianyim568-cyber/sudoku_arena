/**
 * StateRepository — abstract interface for live game state.
 *
 * Production uses RedisStateRepository; dev/test uses MemoryStateRepository.
 * All methods return Promises to match the Redis async API.
 *
 * Timer model: server-authoritative timestamps
 *   - `turnEndsAt` (Unix ms) replaces countdown integers
 *   - Client computes `remaining = max(0, turnEndsAt - Date.now())` locally
 *   - Pause stores `remainingAtPause`; resume recalculates `turnEndsAt`
 */

class StateRepository {
  // ─── Round Timers ──────────────────────────────────────────

  /**
   * Get round timer state.
   * @param {number} roundId
   * @returns {Promise<{turnEndsAt: number, durationSeconds: number, status: string, pausedAt: number|null, remainingAtPause: number|null} | null>}
   */
  async getRoundTimer(roundId) { throw new Error('Not implemented'); }

  /**
   * Set round timer state.
   * @param {number} roundId
   * @param {{turnEndsAt: number, durationSeconds: number, status: string, pausedAt?: number, remainingAtPause?: number}} state
   * @returns {Promise<void>}
   */
  async setRoundTimer(roundId, state) { throw new Error('Not implemented'); }

  /**
   * Delete round timer state.
   * @param {number} roundId
   * @returns {Promise<void>}
   */
  async deleteRoundTimer(roundId) { throw new Error('Not implemented'); }

  /**
   * Get remaining seconds for a round (computed from turnEndsAt - Date.now()).
   * Returns remainingAtPause if paused.
   * @param {number} roundId
   * @returns {Promise<number>} remaining seconds (0 if expired or missing)
   */
  async getRemainingSeconds(roundId) { throw new Error('Not implemented'); }

  // ─── Round 2 Team State ────────────────────────────────────

  /**
   * Get Round 2 team state.
   * @param {number} roundId
   * @param {number} teamId
   * @returns {Promise<{playerPuzzles: Object<number,number>, puzzleGrids: Object<number,Array>, playerOrder: number[], nextRotationAt: number, rotationIntervalMs: number} | null>}
   */
  async getRound2TeamState(roundId, teamId) { throw new Error('Not implemented'); }

  /**
   * Set Round 2 team state.
   * @param {number} roundId
   * @param {number} teamId
   * @param {{playerPuzzles: Map<number,number>, puzzleGrids: Map<number,Array>, playerOrder: number[], nextRotationAt: number, rotationIntervalMs: number}} state
   * @returns {Promise<void>}
   */
  async setRound2TeamState(roundId, teamId, state) { throw new Error('Not implemented'); }

  /**
   * Delete Round 2 team state.
   * @param {number} roundId
   * @param {number} teamId
   * @returns {Promise<void>}
   */
  async deleteRound2TeamState(roundId, teamId) { throw new Error('Not implemented'); }

  /**
   * Update a single cell in a Round 2 puzzle grid.
   * @param {number} roundId
   * @param {number} teamId
   * @param {number} puzzleId
   * @param {Array} grid — full grid to store
   * @returns {Promise<void>}
   */
  async updateRound2PuzzleGrid(roundId, teamId, puzzleId, grid) { throw new Error('Not implemented'); }

  /**
   * Update Round 2 player-to-puzzle assignment.
   * @param {number} roundId
   * @param {number} teamId
   * @param {number} playerId
   * @param {number} puzzleId
   * @returns {Promise<void>}
   */
  async setRound2PlayerPuzzle(roundId, teamId, playerId, puzzleId) { throw new Error('Not implemented'); }

  /**
   * Remove Round 2 player assignment.
   * @param {number} roundId
   * @param {number} teamId
   * @param {number} playerId
   * @returns {Promise<void>}
   */
  async deleteRound2PlayerPuzzle(roundId, teamId, playerId) { throw new Error('Not implemented'); }

  /**
   * Remove Round 2 puzzle grid.
   * @param {number} roundId
   * @param {number} teamId
   * @param {number} puzzleId
   * @returns {Promise<void>}
   */
  async deleteRound2PuzzleGrid(roundId, teamId, puzzleId) { throw new Error('Not implemented'); }

  /**
   * Update Round 2 rotation countdown (nextRotationAt).
   * @param {number} roundId
   * @param {number} teamId
   * @param {number} nextRotationAt — Unix ms
   * @returns {Promise<void>}
   */
  async setRound2NextRotation(roundId, teamId, nextRotationAt) { throw new Error('Not implemented'); }

  /**
   * Atomically assign a puzzle to a player in Round 2.
   * Prevents the read-modify-write race where concurrent operations
   * (submitAnswer + rotatePuzzles) both read the same playerPuzzleMap,
   * both find the same puzzle "available", and both assign it.
   *
   * This method checks that the puzzle is NOT already assigned to any
   * other player before assigning it. If already taken, returns null.
   *
   * @param {number} roundId
   * @param {number} teamId
   * @param {number} playerId
   * @param {number} puzzleId
   * @returns {Promise<number|null>} The assigned puzzleId, or null if already taken
   */
  async acquireRound2Puzzle(roundId, teamId, playerId, puzzleId) { throw new Error('Not implemented'); }

  /**
   * Atomically remove a player's puzzle assignment in Round 2.
   * @param {number} roundId
   * @param {number} teamId
   * @param {number} playerId
   * @returns {Promise<number|null>} The puzzleId that was unassigned, or null
   */
  async releaseRound2PlayerPuzzle(roundId, teamId, playerId) { throw new Error('Not implemented'); }

  /**
   * Atomically get the set of currently assigned puzzle IDs in Round 2.
   * Used to compute available puzzles without a full read-modify-write cycle.
   * @param {number} roundId
   * @param {number} teamId
   * @returns {Promise<Set<number>>} Set of puzzleIds currently assigned to players
   */
  async getRound2AssignedPuzzleIds(roundId, teamId) { throw new Error('Not implemented'); }

  // ─── Round 3 Cells ─────────────────────────────────────────

  /**
   * Get Round 3 claimed cells for a puzzle.
   * @param {number} puzzleId
   * @returns {Promise<Object<string, {value: number, playerId: number, playerName: string}>>}
   */
  async getRound3Cells(puzzleId) { throw new Error('Not implemented'); }

  /**
   * Set all Round 3 cells for a puzzle.
   * @param {number} puzzleId
   * @param {Map<string, {value: number, playerId: number, playerName: string}>} cells
   * @returns {Promise<void>}
   */
  async setRound3Cells(puzzleId, cells) { throw new Error('Not implemented'); }

  /**
   * Delete Round 3 cells for a puzzle.
   * @param {number} puzzleId
   * @returns {Promise<void>}
   */
  async deleteRound3Cells(puzzleId) { throw new Error('Not implemented'); }

  /**
   * Claim a Round 3 cell — atomic first-writer-wins.
   * @param {number} puzzleId
   * @param {number} row
   * @param {number} col
   * @param {number} value
   * @param {number} playerId
   * @param {string} playerName
   * @returns {Promise<{success: boolean, existing: {value: number, playerId: number, playerName: string} | null}>}
   */
  async claimRound3Cell(puzzleId, row, col, value, playerId, playerName) { throw new Error('Not implemented'); }

  // ─── Round 3 Suggestions ─────────────────────────────────────

  /**
   * Get pending suggestions for a puzzle.
   * @param {number} puzzleId
   * @returns {Promise<Object<string, {value: number, playerId: number, playerName: string, timestamp: number}>>}
   */
  async getRound3Suggestions(puzzleId) { throw new Error('Not implemented'); }

  /**
   * Add a suggestion for a cell in Round 3.
   * @param {number} puzzleId
   * @param {number} row
   * @param {number} col
   * @param {number} value
   * @param {number} playerId
   * @param {string} playerName
   * @returns {Promise<void>}
   */
  async addRound3Suggestion(puzzleId, row, col, value, playerId, playerName) { throw new Error('Not implemented'); }

  /**
   * Remove a suggestion (on accept or reject).
   * @param {number} puzzleId
   * @param {string} suggestionKey - "row-col" key
   * @returns {Promise<void>}
   */
  async removeRound3Suggestion(puzzleId, suggestionKey) { throw new Error('Not implemented'); }

  /**
   * Delete all suggestions for a puzzle.
   * @param {number} puzzleId
   * @returns {Promise<void>}
   */
  async deleteRound3Suggestions(puzzleId) { throw new Error('Not implemented'); }

  /**
   * Add an approval vote for a suggestion.
   * @param {number} puzzleId
   * @param {string} suggestionKey - "row-col" key
   * @param {number} voterId - playerId who voted
   * @returns {Promise<void>}
   */
  async addRound3SuggestionVote(puzzleId, suggestionKey, voterId) { throw new Error('Not implemented'); }

  /**
   * Get all votes for a suggestion.
   * @param {number} puzzleId
   * @param {string} suggestionKey - "row-col" key
   * @returns {Promise<number[]>} Array of voter playerIds
   */
  async getRound3SuggestionVotes(puzzleId, suggestionKey) { throw new Error('Not implemented'); }

  /**
   * Remove all votes for a suggestion (on accept/reject/cleanup).
   * @param {number} puzzleId
   * @param {string} suggestionKey - "row-col" key
   * @returns {Promise<void>}
   */
  async deleteRound3SuggestionVotes(puzzleId, suggestionKey) { throw new Error('Not implemented'); }

  /**
   * Remove all votes for all suggestions of a puzzle (on cleanup).
   * @param {number} puzzleId
   * @returns {Promise<void>}
   */
  async deleteAllRound3SuggestionVotes(puzzleId) { throw new Error('Not implemented'); }

  // ─── Round 3 Player Focus ────────────────────────────────────

  /**
   * Set player focus (which cell a player is currently looking at).
   * @param {number} puzzleId
   * @param {number} playerId
   * @param {{row: number, col: number} | null} focus
   * @returns {Promise<void>}
   */
  async setRound3PlayerFocus(puzzleId, playerId, focus) { throw new Error('Not implemented'); }

  /**
   * Get all player focus states for a puzzle.
   * @param {number} puzzleId
   * @returns {Promise<Object<number, {row: number, col: number}>>}
   */
  async getRound3PlayerFocuses(puzzleId) { throw new Error('Not implemented'); }

  /**
   * Remove all player focus states for a puzzle.
   * @param {number} puzzleId
   * @returns {Promise<void>}
   */
  async deleteRound3PlayerFocuses(puzzleId) { throw new Error('Not implemented'); }

  // ─── Stage Context ─────────────────────────────────────────

  /**
   * Get stage context for a competition.
   * @param {string} competitionId
   * @returns {Promise<Object|null>} stage context or null
   */
  async getStageContext(competitionId) { throw new Error('Not implemented'); }

  /**
   * Set stage context for a competition.
   * @param {string} competitionId
   * @param {Object} context — stage context object
   * @returns {Promise<void>}
   */
  async setStageContext(competitionId, context) { throw new Error('Not implemented'); }

  /**
   * Delete stage context for a competition.
   * @param {string} competitionId
   * @returns {Promise<void>}
   */
  async deleteStageContext(competitionId) { throw new Error('Not implemented'); }

  // ─── Active Players ────────────────────────────────────────

  /**
   * Set active player (heartbeat).
   * @param {number} competitionId
   * @param {number} userId
   * @param {string} socketId
   * @returns {Promise<void>}
   */
  async setActivePlayer(competitionId, userId, socketId) { throw new Error('Not implemented'); }

  /**
   * Remove active player.
   * @param {number} competitionId
   * @param {number} userId
   * @returns {Promise<void>}
   */
  async removeActivePlayer(competitionId, userId) { throw new Error('Not implemented'); }

  /**
   * Get all active players for a competition.
   * @param {number} competitionId
   * @returns {Promise<Object<number, string>>} userId -> socketId
   */
  async getActivePlayers(competitionId) { throw new Error('Not implemented'); }
}

module.exports = StateRepository;
