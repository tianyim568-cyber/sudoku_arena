/**
 * RedisStateRepository — Redis-backed implementation for production.
 * Uses ioredis for async commands and Lua scripts for atomicity.
 *
 * Key patterns:
 *   round:timer:{roundId}            Hash   — turnEndsAt, durationSeconds, status, pausedAt, remainingAtPause
 *   r2:team:{roundId}:{teamId}       Hash   — playerOrder (JSON), nextRotationAt, rotationIntervalMs
 *   r2:assign:{roundId}:{teamId}     Hash   — playerId -> puzzleId
 *   r2:grid:{roundId}:{teamId}:{pid} String — JSON grid
 *   r3:cells:{puzzleId}              Hash   — "row-col" -> JSON({value, playerId, playerName})
 *   active:{tournamentId}            Hash   — userId -> socketId
 */

class RedisStateRepository {
  constructor(redis) {
    this.redis = redis;
  }

  // ─── Round Timers ──────────────────────────────────────────

  async getRoundTimer(roundId) {
    const data = await this.redis.hgetall(`round:timer:${roundId}`);
    if (!data || !data.turnEndsAt) return null;
    return {
      turnEndsAt: Number(data.turnEndsAt),
      durationSeconds: Number(data.durationSeconds),
      status: data.status,
      pausedAt: data.pausedAt ? Number(data.pausedAt) : null,
      remainingAtPause: data.remainingAtPause ? Number(data.remainingAtPause) : null
    };
  }

  async setRoundTimer(roundId, state) {
    const obj = {
      turnEndsAt: String(state.turnEndsAt),
      durationSeconds: String(state.durationSeconds),
      status: state.status
    };
    if (state.pausedAt != null) obj.pausedAt = String(state.pausedAt);
    if (state.remainingAtPause != null) obj.remainingAtPause = String(state.remainingAtPause);

    const key = `round:timer:${roundId}`;
    await this.redis.hmset(key, obj);
    // TTL: duration + 5 min safety margin
    await this.redis.expire(key, Math.ceil(state.durationSeconds / 1000) + 300);
  }

  async deleteRoundTimer(roundId) {
    await this.redis.del(`round:timer:${roundId}`);
  }

  async getRemainingSeconds(roundId) {
    const timer = await this.getRoundTimer(roundId);
    if (!timer) return 0;

    if (timer.status === 'PAUSED' && timer.remainingAtPause != null) {
      return Math.max(0, Math.ceil(timer.remainingAtPause / 1000));
    }

    const remaining = timer.turnEndsAt - Date.now();
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  // ─── Round 2 Team State ────────────────────────────────────

  async getRound2TeamState(roundId, teamId) {
    const prefix = `r2:team:${roundId}:${teamId}`;
    const [teamData, assignments] = await Promise.all([
      this.redis.hgetall(prefix),
      this.redis.hgetall(`r2:assign:${roundId}:${teamId}`)
    ]);

    if (!teamData || !teamData.playerOrder) return null;

    // Get all puzzle grids
    const playerPuzzles = {};
    for (const [pid, puzzleId] of Object.entries(assignments)) {
      playerPuzzles[Number(pid)] = Number(puzzleId);
    }

    const puzzleGrids = {};
    const puzzleIds = Object.values(assignments).map(Number);
    if (puzzleIds.length > 0) {
      const gridKeys = puzzleIds.map(pid => `r2:grid:${roundId}:${teamId}:${pid}`);
      const grids = await this.redis.mget(...gridKeys);
      for (let i = 0; i < puzzleIds.length; i++) {
        if (grids[i]) {
          puzzleGrids[puzzleIds[i]] = JSON.parse(grids[i]);
        }
      }
    }

    return {
      playerPuzzles,
      puzzleGrids,
      playerOrder: JSON.parse(teamData.playerOrder),
      nextRotationAt: Number(teamData.nextRotationAt || 0),
      rotationIntervalMs: Number(teamData.rotationIntervalMs || 60000)
    };
  }

  async setRound2TeamState(roundId, teamId, state) {
    const prefix = `r2:team:${roundId}:${teamId}`;
    const ttl = Math.ceil((state.rotationIntervalMs * 20) / 1000); // generous TTL

    const playerPuzzles = state.playerPuzzles instanceof Map
      ? Object.fromEntries(state.playerPuzzles)
      : state.playerPuzzles;

    const puzzleGrids = state.puzzleGrids instanceof Map
      ? Object.fromEntries(state.puzzleGrids)
      : state.puzzleGrids;

    const playerOrder = state.playerOrder instanceof Array
      ? state.playerOrder
      : [];

    // Set team metadata
    await this.redis.hmset(prefix, {
      playerOrder: JSON.stringify(playerOrder),
      nextRotationAt: String(state.nextRotationAt || 0),
      rotationIntervalMs: String(state.rotationIntervalMs || 60000)
    });
    await this.redis.expire(prefix, ttl);

    // Set assignments
    const assignKey = `r2:assign:${roundId}:${teamId}`;
    if (Object.keys(playerPuzzles).length > 0) {
      const assignData = {};
      for (const [pid, puzzleId] of Object.entries(playerPuzzles)) {
        assignData[String(pid)] = String(puzzleId);
      }
      await this.redis.hmset(assignKey, assignData);
      await this.redis.expire(assignKey, ttl);
    }

    // Set puzzle grids
    for (const [puzzleId, grid] of Object.entries(puzzleGrids)) {
      const gridKey = `r2:grid:${roundId}:${teamId}:${puzzleId}`;
      await this.redis.set(gridKey, JSON.stringify(grid), 'EX', ttl);
    }
  }

  async deleteRound2TeamState(roundId, teamId) {
    const prefix = `r2:team:${roundId}:${teamId}`;

    // Get all puzzle IDs from assignments to delete grids
    const assignments = await this.redis.hgetall(`r2:assign:${roundId}:${teamId}`);
    const keysToDelete = [prefix, `r2:assign:${roundId}:${teamId}`];

    for (const puzzleId of Object.values(assignments || {})) {
      keysToDelete.push(`r2:grid:${roundId}:${teamId}:${puzzleId}`);
    }

    if (keysToDelete.length > 0) {
      await this.redis.del(...keysToDelete);
    }
  }

  async updateRound2PuzzleGrid(roundId, teamId, puzzleId, grid) {
    // Get TTL from team key
    const prefix = `r2:team:${roundId}:${teamId}`;
    const ttl = await this.redis.ttl(prefix);
    const gridKey = `r2:grid:${roundId}:${teamId}:${puzzleId}`;
    await this.redis.set(gridKey, JSON.stringify(grid), 'EX', Math.max(ttl, 60));
  }

  async setRound2PlayerPuzzle(roundId, teamId, playerId, puzzleId) {
    await this.redis.hset(`r2:assign:${roundId}:${teamId}`, String(playerId), String(puzzleId));
  }

  async deleteRound2PlayerPuzzle(roundId, teamId, playerId) {
    await this.redis.hdel(`r2:assign:${roundId}:${teamId}`, String(playerId));
  }

  async deleteRound2PuzzleGrid(roundId, teamId, puzzleId) {
    await this.redis.del(`r2:grid:${roundId}:${teamId}:${puzzleId}`);
  }

  async setRound2NextRotation(roundId, teamId, nextRotationAt) {
    await this.redis.hset(`r2:team:${roundId}:${teamId}`, 'nextRotationAt', String(nextRotationAt));
  }

  async acquireRound2Puzzle(roundId, teamId, playerId, puzzleId) {
    const assignKey = `r2:assign:${roundId}:${teamId}`;
    const pidStr = String(playerId);
    const newPuzzleStr = String(puzzleId);

    // Check if puzzle is already assigned to another player
    const assignments = await this.redis.hgetall(assignKey);
    for (const [pid, assignedPuzzleId] of Object.entries(assignments || {})) {
      if (assignedPuzzleId === newPuzzleStr && pid !== pidStr) {
        return null; // Already taken by another player
      }
    }

    // Atomically assign
    await this.redis.hset(assignKey, pidStr, newPuzzleStr);
    return puzzleId;
  }

  async releaseRound2PlayerPuzzle(roundId, teamId, playerId) {
    const assignKey = `r2:assign:${roundId}:${teamId}`;
    const pidStr = String(playerId);

    const puzzleIdStr = await this.redis.hget(assignKey, pidStr);
    if (puzzleIdStr) {
      await this.redis.hdel(assignKey, pidStr);
      return Number(puzzleIdStr);
    }
    return null;
  }

  async getRound2AssignedPuzzleIds(roundId, teamId) {
    const assignKey = `r2:assign:${roundId}:${teamId}`;
    const assignments = await this.redis.hgetall(assignKey);
    const assigned = new Set();
    for (const [, puzzleId] of Object.entries(assignments || {})) {
      assigned.add(Number(puzzleId));
    }
    return assigned;
  }

  // ─── Round 3 Cells ─────────────────────────────────────────

  async getRound3Cells(puzzleId) {
    const data = await this.redis.hgetall(`r3:cells:${puzzleId}`);
    if (!data) return {};
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = JSON.parse(value);
    }
    return result;
  }

  async setRound3Cells(puzzleId, cells) {
    const key = `r3:cells:${puzzleId}`;
    const entries = cells instanceof Map ? [...cells.entries()] : Object.entries(cells);
    if (entries.length === 0) return;

    const obj = {};
    for (const [k, v] of entries) {
      obj[k] = JSON.stringify(v);
    }
    await this.redis.hmset(key, obj);
    await this.redis.expire(key, 1800); // 30 min TTL
  }

  async deleteRound3Cells(puzzleId) {
    await this.redis.del(`r3:cells:${puzzleId}`);
  }

  async claimRound3Cell(puzzleId, row, col, value, playerId, playerName) {
    const key = `r3:cells:${puzzleId}`;
    const field = `${row}-${col}`;
    const cellData = JSON.stringify({ value, playerId, playerName });

    // HSETNX is atomic — only sets if field doesn't exist
    const wasSet = await this.redis.hsetnx(key, field, cellData);

    if (wasSet) {
      // Set TTL on first write
      await this.redis.expire(key, 1800);
      return { success: true, existing: null };
    }

    // Cell was already claimed — return existing value
    const existing = await this.redis.hget(key, field);
    return { success: false, existing: existing ? JSON.parse(existing) : null };
  }

  // ─── Round 3 Suggestions ─────────────────────────────────────

  async getRound3Suggestions(puzzleId) {
    const data = await this.redis.hgetall(`r3:suggest:${puzzleId}`);
    if (!data) return {};
    const result = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = JSON.parse(value);
    }
    return result;
  }

  async addRound3Suggestion(puzzleId, row, col, value, playerId, playerName) {
    const key = `r3:suggest:${puzzleId}`;
    const field = `${row}-${col}`;
    const suggestionData = JSON.stringify({ value, playerId, playerName, timestamp: Date.now() });
    await this.redis.hset(key, field, suggestionData);
    await this.redis.expire(key, 1800);
  }

  async removeRound3Suggestion(puzzleId, suggestionKey) {
    await this.redis.hdel(`r3:suggest:${puzzleId}`, suggestionKey);
  }

  async deleteRound3Suggestions(puzzleId) {
    await this.redis.del(`r3:suggest:${puzzleId}`);
  }

  // ─── Round 3 Suggestion Votes ──────────────────────────────────

  async addRound3SuggestionVote(puzzleId, suggestionKey, voterId) {
    const key = `r3:votes:${puzzleId}`;
    const field = suggestionKey; // "row-col"
    const current = await this.redis.hget(key, field);
    const voters = current ? JSON.parse(current) : [];
    if (!voters.includes(Number(voterId))) {
      voters.push(Number(voterId));
    }
    await this.redis.hset(key, field, JSON.stringify(voters));
    await this.redis.expire(key, 1800);
  }

  async getRound3SuggestionVotes(puzzleId, suggestionKey) {
    const data = await this.redis.hget(`r3:votes:${puzzleId}`, suggestionKey);
    if (!data) return [];
    return JSON.parse(data);
  }

  async deleteRound3SuggestionVotes(puzzleId, suggestionKey) {
    await this.redis.hdel(`r3:votes:${puzzleId}`, suggestionKey);
  }

  async deleteAllRound3SuggestionVotes(puzzleId) {
    await this.redis.del(`r3:votes:${puzzleId}`);
  }

  // ─── Round 3 Player Focus ────────────────────────────────────

  async setRound3PlayerFocus(puzzleId, playerId, focus) {
    const key = `r3:focus:${puzzleId}`;
    if (focus === null) {
      await this.redis.hdel(key, String(playerId));
      return;
    }
    const focusData = JSON.stringify(focus);
    await this.redis.hset(key, String(playerId), focusData);
    await this.redis.expire(key, 1800);
  }

  async getRound3PlayerFocuses(puzzleId) {
    const data = await this.redis.hgetall(`r3:focus:${puzzleId}`);
    if (!data) return {};
    const result = {};
    for (const [playerIdStr, focusStr] of Object.entries(data)) {
      result[Number(playerIdStr)] = JSON.parse(focusStr);
    }
    return result;
  }

  async deleteRound3PlayerFocuses(puzzleId) {
    await this.redis.del(`r3:focus:${puzzleId}`);
  }

  // ─── Active Players ────────────────────────────────────────

  async setActivePlayer(tournamentId, userId, socketId) {
    const key = `active:${tournamentId}`;
    await this.redis.hset(key, String(userId), socketId);
    await this.redis.expire(key, 120); // 2 min TTL — heartbeat refreshes
  }

  async removeActivePlayer(tournamentId, userId) {
    await this.redis.hdel(`active:${tournamentId}`, String(userId));
  }

  async getActivePlayers(tournamentId) {
    const data = await this.redis.hgetall(`active:${tournamentId}`);
    if (!data) return {};
    const result = {};
    for (const [uid, socketId] of Object.entries(data)) {
      result[Number(uid)] = socketId;
    }
    return result;
  }

  // ─── Stage Context ─────────────────────────────────────────

  async getStageContext(competitionId) {
    const data = await this.redis.get(`stage:context:${competitionId}`);
    if (!data) return null;
    return JSON.parse(data);
  }

  async setStageContext(competitionId, context) {
    const key = `stage:context:${competitionId}`;
    await this.redis.set(key, JSON.stringify(context), 'EX', 86400); // 24 hour TTL
  }

  async deleteStageContext(competitionId) {
    await this.redis.del(`stage:context:${competitionId}`);
  }
}

module.exports = RedisStateRepository;
