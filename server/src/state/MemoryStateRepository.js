/**
 * MemoryStateRepository — in-memory Maps implementation for dev/fallback.
 * Drop-in replacement for RedisStateRepository; same async API.
 */

class MemoryStateRepository {
  constructor() {
    // Round timers: roundId -> {turnEndsAt, durationSeconds, status, pausedAt, remainingAtPause}
    this._timers = new Map();

    // Round 2 team state
    // roundId:teamId -> {playerPuzzles: Map<playerId,puzzleId>, puzzleGrids: Map<puzzleId,grid>, playerOrder: [], nextRotationAt, rotationIntervalMs}
    this._r2Teams = new Map();

    // Round 3 cells: puzzleId -> Map<"row-col", {value, playerId, playerName}>
    this._r3Cells = new Map();

    // Round 3 suggestions: puzzleId -> Map<"row-col", {value, playerId, playerName, votes: Set<playerId>}>
    this._r3Suggestions = new Map();

    // Round 3 player focuses: puzzleId -> Map<playerId, {row, col, playerName}>
    this._r3PlayerFocuses = new Map();

    // Round 3 suggestion votes: puzzleId -> Map<"row-col", Set<playerId>>
    this._r3SuggestionVotes = new Map();

    // Stage contexts: competitionId -> context object
    this._stageContexts = new Map();

    // Active players: roundId -> Set<playerId>
    this._activePlayers = new Map();

    // Individual round player grids: roundId:playerId:puzzleId -> grid
    this._individualPlayerGrids = new Map();
  }

  // ─── Round Timers ──────────────────────────────────────────

  async getRoundTimer(roundId) {
    return this._timers.get(roundId) || null;
  }

  async setRoundTimer(roundId, state) {
    this._timers.set(roundId, { ...state });
  }

  async deleteRoundTimer(roundId) {
    this._timers.delete(roundId);
  }

  async getRemainingSeconds(roundId) {
    const timer = this._timers.get(roundId);
    if (!timer) return 0;

    if (timer.status === 'PAUSED' && timer.remainingAtPause != null) {
      return Math.max(0, Math.ceil(timer.remainingAtPause / 1000));
    }

    const remaining = timer.turnEndsAt - Date.now();
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  // ─── Round 2 Team State ────────────────────────────────────

  _r2k(roundId, teamId) { return `${roundId}:${teamId}`; }

  async getRound2TeamState(roundId, teamId) {
    const state = this._r2Teams.get(this._r2k(roundId, teamId));
    if (!state) return null;

    return {
      playerPuzzles: Object.fromEntries(state.playerPuzzles),
      puzzleGrids: Object.fromEntries(state.puzzleGrids),
      playerOrder: state.playerOrder,
      nextRotationAt: state.nextRotationAt,
      rotationIntervalMs: state.rotationIntervalMs
    };
  }

  async setRound2TeamState(roundId, teamId, state) {
    const playerPuzzles = state.playerPuzzles instanceof Map
      ? new Map(state.playerPuzzles)
      : new Map(Object.entries(state.playerPuzzles).map(([k, v]) => [Number(k), v]));

    const puzzleGrids = state.puzzleGrids instanceof Map
      ? new Map(state.puzzleGrids)
      : new Map(Object.entries(state.puzzleGrids).map(([k, v]) => [Number(k), v]));

    this._r2Teams.set(this._r2k(roundId, teamId), {
      playerPuzzles,
      puzzleGrids,
      playerOrder: [...state.playerOrder],
      nextRotationAt: state.nextRotationAt,
      rotationIntervalMs: state.rotationIntervalMs
    });
  }

  async deleteRound2TeamState(roundId, teamId) {
    this._r2Teams.delete(this._r2k(roundId, teamId));
  }

  async updateRound2PuzzleGrid(roundId, teamId, puzzleId, grid) {
    const state = this._r2Teams.get(this._r2k(roundId, teamId));
    if (state) {
      state.puzzleGrids.set(puzzleId, grid);
    }
  }

  async setRound2PlayerPuzzle(roundId, teamId, playerId, puzzleId) {
    const state = this._r2Teams.get(this._r2k(roundId, teamId));
    if (state) {
      state.playerPuzzles.set(playerId, puzzleId);
    }
  }

  async deleteRound2PlayerPuzzle(roundId, teamId, playerId) {
    const state = this._r2Teams.get(this._r2k(roundId, teamId));
    if (state) {
      state.playerPuzzles.delete(playerId);
    }
  }

  async deleteRound2PuzzleGrid(roundId, teamId, puzzleId) {
    const state = this._r2Teams.get(this._r2k(roundId, teamId));
    if (state) {
      state.puzzleGrids.delete(puzzleId);
    }
  }

  async setRound2NextRotation(roundId, teamId, nextRotationAt) {
    const state = this._r2Teams.get(this._r2k(roundId, teamId));
    if (state) {
      state.nextRotationAt = nextRotationAt;
    }
  }

  async acquireRound2Puzzle(roundId, teamId, playerId, puzzleId) {
    const state = this._r2Teams.get(this._r2k(roundId, teamId));
    if (!state) return null;

    // Check if puzzle is already assigned to another player
    for (const [pid, assignedPuzzleId] of state.playerPuzzles) {
      if (assignedPuzzleId === puzzleId && pid !== playerId) {
        return null; // Already taken by another player
      }
    }

    // Atomically assign
    state.playerPuzzles.set(playerId, puzzleId);
    return puzzleId;
  }

  async releaseRound2PlayerPuzzle(roundId, teamId, playerId) {
    const state = this._r2Teams.get(this._r2k(roundId, teamId));
    if (!state) return null;

    const puzzleId = state.playerPuzzles.get(playerId);
    if (puzzleId != null) {
      state.playerPuzzles.delete(playerId);
      return puzzleId;
    }
    return null;
  }

  async getRound2AssignedPuzzleIds(roundId, teamId) {
    const state = this._r2Teams.get(this._r2k(roundId, teamId));
    if (!state) return new Set();

    const assigned = new Set();
    for (const [, puzzleId] of state.playerPuzzles) {
      assigned.add(puzzleId);
    }
    return assigned;
  }

  // ─── Round 3 Cells ─────────────────────────────────────────

  async getRound3Cells(puzzleId) {
    const cells = this._r3Cells.get(puzzleId);
    if (!cells) return {};
    return Object.fromEntries(cells);
  }

  async setRound3Cells(puzzleId, cells) {
    const map = cells instanceof Map ? new Map(cells) : new Map(Object.entries(cells));
    this._r3Cells.set(puzzleId, map);
  }

  async deleteRound3Cells(puzzleId) {
    this._r3Cells.delete(puzzleId);
  }

  async claimRound3Cell(puzzleId, row, col, value, playerId, playerName) {
    let cells = this._r3Cells.get(puzzleId);
    if (!cells) {
      cells = new Map();
      this._r3Cells.set(puzzleId, cells);
    }

    const key = `${row}-${col}`;
    const existing = cells.get(key);
    if (existing) {
      return { success: false, existing };
    }

    cells.set(key, { value, playerId, playerName });
    return { success: true, existing: null };
  }

  // ─── Round 3 Suggestions ─────────────────────────────────────

  async getRound3Suggestions(puzzleId) {
    const suggestions = this._r3Suggestions.get(puzzleId);
    if (!suggestions) return {};
    return Object.fromEntries(suggestions);
  }

  async addRound3Suggestion(puzzleId, row, col, value, playerId, playerName) {
    let suggestions = this._r3Suggestions.get(puzzleId);
    if (!suggestions) {
      suggestions = new Map();
      this._r3Suggestions.set(puzzleId, suggestions);
    }
    const key = `${row}-${col}`;
    suggestions.set(key, { value, playerId, playerName, timestamp: Date.now() });
  }

  async removeRound3Suggestion(puzzleId, suggestionKey) {
    const suggestions = this._r3Suggestions.get(puzzleId);
    if (suggestions) {
      suggestions.delete(suggestionKey);
    }
  }

  async deleteRound3Suggestions(puzzleId) {
    this._r3Suggestions.delete(puzzleId);
  }

  // ─── Round 3 Suggestion Votes ──────────────────────────────────

  async addRound3SuggestionVote(puzzleId, suggestionKey, voterId) {
    let votes = this._r3SuggestionVotes.get(puzzleId);
    if (!votes) {
      votes = new Map();
      this._r3SuggestionVotes.set(puzzleId, votes);
    }
    let keyVotes = votes.get(suggestionKey);
    if (!keyVotes) {
      keyVotes = new Set();
      votes.set(suggestionKey, keyVotes);
    }
    keyVotes.add(Number(voterId));
  }

  async getRound3SuggestionVotes(puzzleId, suggestionKey) {
    const votes = this._r3SuggestionVotes.get(puzzleId);
    if (!votes) return [];
    const keyVotes = votes.get(suggestionKey);
    if (!keyVotes) return [];
    return [...keyVotes];
  }

  async deleteRound3SuggestionVotes(puzzleId, suggestionKey) {
    const votes = this._r3SuggestionVotes.get(puzzleId);
    if (votes) {
      votes.delete(suggestionKey);
    }
  }

  async deleteAllRound3SuggestionVotes(puzzleId) {
    this._r3SuggestionVotes.delete(puzzleId);
  }

  // ─── Round 3 Player Focus ────────────────────────────────────

  async setRound3PlayerFocus(puzzleId, playerId, focus) {
    let focuses = this._r3PlayerFocuses.get(puzzleId);
    if (!focuses) {
      focuses = new Map();
      this._r3PlayerFocuses.set(puzzleId, focuses);
    }
    if (focus === null) {
      focuses.delete(playerId);
    } else {
      focuses.set(playerId, focus);
    }
  }

  async getRound3PlayerFocuses(puzzleId) {
    const focuses = this._r3PlayerFocuses.get(puzzleId);
    if (!focuses) return {};
    return Object.fromEntries(focuses);
  }

  async deleteRound3PlayerFocuses(puzzleId) {
    this._r3PlayerFocuses.delete(puzzleId);
  }

  // ─── Active Players ────────────────────────────────────────

  async setActivePlayer(competitionId, userId, socketId) {
    if (!this._activePlayers.has(competitionId)) {
      this._activePlayers.set(competitionId, new Map());
    }
    this._activePlayers.get(competitionId).set(userId, socketId);
  }

  async removeActivePlayer(competitionId, userId) {
    const players = this._activePlayers.get(competitionId);
    if (players) {
      players.delete(userId);
    }
  }

  async getActivePlayers(competitionId) {
    const players = this._activePlayers.get(competitionId);
    if (!players) return {};
    return Object.fromEntries(players);
  }

  // ─── Stage Context ─────────────────────────────────────────

  async getStageContext(competitionId) {
    return this._stageContexts.get(competitionId) || null;
  }

  async setStageContext(competitionId, context) {
    this._stageContexts.set(competitionId, { ...context });
  }

  async deleteStageContext(competitionId) {
    this._stageContexts.delete(competitionId);
  }

  // ─── Individual Player Grids (auto-save) ─────────────────────

  _igKey(roundId, playerId, puzzleId) {
    return `${roundId}:${playerId}:${puzzleId}`;
  }

  async setIndividualPlayerGrid(roundId, playerId, puzzleId, grid) {
    this._individualPlayerGrids.set(this._igKey(roundId, playerId, puzzleId), grid);
  }

  async getIndividualPlayerGrid(roundId, playerId, puzzleId) {
    return this._individualPlayerGrids.get(this._igKey(roundId, playerId, puzzleId)) || null;
  }

  async deleteIndividualPlayerGrids(roundId) {
    const prefix = `${roundId}:`;
    for (const key of this._individualPlayerGrids.keys()) {
      if (key.startsWith(prefix)) {
        this._individualPlayerGrids.delete(key);
      }
    }
  }

  async getIndividualGridsByPlayer(roundId, playerId) {
    const prefix = `${roundId}:${playerId}:`;
    const result = {};
    for (const [key, grid] of this._individualPlayerGrids.entries()) {
      if (key.startsWith(prefix)) {
        const puzzleId = key.substring(prefix.length);
        result[puzzleId] = grid;
      }
    }
    return result;
  }
}

module.exports = MemoryStateRepository;
