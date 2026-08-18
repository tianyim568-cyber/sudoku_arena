/**
 * SocketManager — thin transport layer replacing socketHandler.js.
 *
 * Responsibilities:
 *   - Socket.io auth middleware (JWT)
 *   - Room management (join/leave)
 *   - Heartbeat-based active player tracking via StateRepository
 *   - Late-join sync via orchestrator.getReconnectState()
 *   - Socket event routing (cell_fill, answer_submit, round2_cell_update)
 *   - EmissionBus subscription → Socket.io room emission
 *
 * Does NOT:
 *   - Construct late-join state inline (delegates to orchestrator)
 *   - Hold any game logic
 *
 * Vocabulary: `competitionId` throughout, matching competitions.id.
 *
 * Three naming surfaces had to move together, and none may drift apart:
 *   1. The wire payload field `competitionId` — written by
 *      client/src/api/socket.js, validated by validations/socket.js, read
 *      here. A rename on only one side would not throw; the Zod schema is
 *      what turns the mismatch into a visible VALIDATION_ERROR.
 *   2. The Socket.IO room names `competition_<uuid>` and
 *      `team_<uuid>_<teamId>` — server-internal, never named by the client.
 *   3. The emission discriminator `target: 'competition'` — produced by
 *      engine/RoundEngine.js, consumed by _routeEmission below.
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const { getPrisma } = require('../db/prisma');
const {
  joinRoomSchema,
  leaveRoomSchema,
  cellFillSchema,
  answerSubmitSchema,
} = require('../validations/socket');

class SocketManager {
  /**
   * @param {import('socket.io').Server} io
   * @param {import('../db/index')} repos
   * @param {import('../engine/GameOrchestrator')} orchestrator
   * @param {import('./EmissionBus')} bus
   */
  constructor(io, repos, orchestrator, bus, presenceService, displayManager) {
    this.io = io;
    this.repos = repos;
    this.orchestrator = orchestrator;
    this.presenceService = presenceService; // optional, for monitoring
    this.displayManager = displayManager; // optional, for display token auth

    // Throttle map for PLAYER_GRID_UPDATE: key = `${competitionId}:${playerId}`, value = timestamp
    this._gridUpdateThrottle = new Map();
    this._gridUpdateThrottleIntervalMs = 500; // Max 2 updates/sec per player

    // Rate limit config (per-connection token bucket)
    this._rateLimitMax = config.WS_RATE_LIMIT; // max tokens (events per second)
    this._rateLimitRefillRate = config.WS_RATE_LIMIT; // tokens refilled per second

    // Subscribe to EmissionBus — both queued and immediate emissions
    bus.on('emission', (e) => this._routeEmission(e));
    bus.on('immediate', (e) => this._routeEmission(e));

    this._setupAuth();
    this._setupConnection();
  }

  // ─── Display connection handler ─────────────────────────────────

  /**
   * Handle display-only socket connections.
   * Display sockets are read-only — no game actions, no heartbeat, no user rooms.
   * They auto-join the display room for a competition to receive real-time
   * DISPLAY_MODE_CHANGED and RANKING_UPDATE events.
   * @param {import('socket.io').Socket} socket
   */
  _handleDisplayConnection(socket) {
    const { competitionId } = socket.user;
    console.log(`[display] connected for competition ${competitionId}`);

    // Auto-join display room
    socket.join(`display_${competitionId}`);

    socket.on('disconnect', () => {
      console.log(`[display] disconnected for competition ${competitionId}`);
    });
  }

  // ─── Emission routing ─────────────────────────────────────────

  _routeEmission(e) {
    // When a participant status changes (from PresenceService sweep or explicit emit),
    // trigger a full list update to judges — this is the judge-only PARTICIPANT_LIST_STATE_UPDATE.
    if (e.event === 'PARTICIPANT_STATUS_CHANGE') {
      const compId = typeof e.targetId === 'string' ? e.targetId : e.payload?.competitionId;
      if (compId) {
        // Fire-and-forget; errors are caught inside _emitParticipantListUpdate
        this._emitParticipantListUpdate(compId);
      }
    }

    const msg = {
      type: e.event,
      timestamp: new Date().toISOString(),
      competitionId: null,
      payload: e.payload
    };

    if (e.target === 'competition') {
      msg.competitionId = e.targetId;
      this.io.to(`competition_${e.targetId}`).emit('event', msg);
    } else if (e.target === 'team') {
      msg.competitionId = e.targetId.competitionId;
      this.io.to(`team_${e.targetId.competitionId}_${e.targetId.teamId}`).emit('event', msg);
    } else if (e.target === 'user') {
      this.io.to(`user_${e.targetId}`).emit('event', msg);
    } else if (e.target === 'display') {
      msg.competitionId = e.targetId;
      this.io.to(`display_${e.targetId}`).emit('event', msg);
    }
  }

  /**
   * Emit PARTICIPANT_LIST_STATE_UPDATE to all judges for a competition.
   * Fetches current participant list with online status and sends to each judge's user room.
   * @param {string} competitionId
   */
  async _emitParticipantListUpdate(competitionId) {
    try {
      // Get all judges for this competition
      const judges = await this.repos.teams.getJudges(competitionId);
      if (!judges || judges.length === 0) return;

      // Get all participants with team info
      const participants = await this.repos.participants.findByCompetition(competitionId);

      // Get online status from state repository
      const activePlayers = await this.orchestrator.state.getActivePlayers(competitionId);

      // Build participant list with status
      const participantList = participants.map(p => {
        const activeData = activePlayers[p.user_id];
        const online = !!activeData;
        return {
          id: p.id,
          name: p.name,
          school: p.school || null,
          teamId: p.team_members?.[0]?.team_id || null,
          teamName: p.team_name || null,
          online,
          lastHeartbeatAt: activeData ? activeData.lastHeartbeatAt : null
        };
      });

      // Build the event message
      const msg = {
        type: 'PARTICIPANT_LIST_STATE_UPDATE',
        timestamp: new Date().toISOString(),
        competitionId,
        payload: {
          participants: participantList,
          summary: {
            total: participantList.length,
            online: participantList.filter(p => p.online).length,
            offline: participantList.filter(p => !p.online).length
          }
        }
      };

      // Send to each judge's user room
      for (const judge of judges) {
        this.io.to(`user_${judge.user_id}`).emit('event', msg);
      }
    } catch (err) {
      // Log but don't crash — monitoring updates are non-critical
      console.error(`[SocketManager] Failed to emit PARTICIPANT_LIST_STATE_UPDATE for ${competitionId}:`, err.message);
    }
  }

  /**
   * Emit PLAYER_GRID_UPDATE to judges for a specific player, throttled to max 2/sec per player.
   * @param {string} competitionId
   * @param {string} playerId - Participant UUID
   * @param {string} puzzleId
   * @param {object} grid - Current grid state
   */
  async _emitPlayerGridUpdate(competitionId, playerId, puzzleId, grid) {
    const throttleKey = `${competitionId}:${playerId}`;
    const now = Date.now();
    const lastEmit = this._gridUpdateThrottle.get(throttleKey) || 0;

    // Throttle: max 2 updates/sec (500ms interval)
    if (now - lastEmit < this._gridUpdateThrottleIntervalMs) {
      return;
    }
    this._gridUpdateThrottle.set(throttleKey, now);

    try {
      // Get all judges for this competition
      const judges = await this.repos.teams.getJudges(competitionId);
      if (!judges || judges.length === 0) return;

      // Build the event message
      const msg = {
        type: 'PLAYER_GRID_UPDATE',
        timestamp: new Date().toISOString(),
        competitionId,
        payload: {
          playerId,
          puzzleId,
          grid
        }
      };

      // Send to each judge's user room
      for (const judge of judges) {
        this.io.to(`user_${judge.user_id}`).emit('event', msg);
      }
    } catch (err) {
      // Log but don't crash — grid updates are non-critical
      console.error(`[SocketManager] Failed to emit PLAYER_GRID_UPDATE for ${playerId}:`, err.message);
    }
  }

  // ─── Rate limiting ───────────────────────────────────────────

  /**
   * Create a per-connection token bucket rate limiter.
   * Returns an object with a `consume()` method that returns true if the event
   * is allowed, false if rate-limited.
   * @returns {{ consume: () => boolean }}
   */
  _createRateLimiter() {
    const maxTokens = this._rateLimitMax;
    const refillRate = this._rateLimitRefillRate; // tokens per second
    let tokens = maxTokens;
    let lastRefill = Date.now();

    return {
      consume() {
        const now = Date.now();
        const elapsed = (now - lastRefill) / 1000; // seconds
        tokens = Math.min(maxTokens, tokens + elapsed * refillRate);
        lastRefill = now;

        if (tokens >= 1) {
          tokens -= 1;
          return true;
        }
        return false;
      }
    };
  }

  /**
   * Check rate limit for a socket event. If exceeded, emit RATE_LIMIT_EXCEEDED
   * and return false. Otherwise return true.
   * @param {{ consume: () => boolean }} limiter
   * @param {object} socket
   * @param {string} eventName
   * @returns {boolean}
   */
  _checkRateLimit(limiter, socket, eventName) {
    if (!limiter.consume()) {
      socket.emit('event', {
        type: 'RATE_LIMIT_EXCEEDED',
        timestamp: new Date().toISOString(),
        payload: {
          event: eventName,
          message: 'Too many requests, please slow down'
        }
      });
      return false;
    }
    return true;
  }

  // ─── Message validation ───────────────────────────────────────

  // Validate an incoming message against a Zod schema. On failure, emit a
  // VALIDATION_ERROR event back to the sender and return null so the caller
  // aborts before any game logic runs.
  _validate(schema, data, socket, eventName) {
    const result = schema.safeParse(data);
    if (!result.success) {
      socket.emit('event', {
        type: 'VALIDATION_ERROR',
        timestamp: new Date().toISOString(),
        payload: { event: eventName, message: result.error.issues[0]?.message || 'Invalid message data' },
      });
      return null;
    }
    return result.data;
  }

  // ─── Auth middleware ───────────────────────────────────────────

  _setupAuth() {
    this.io.use(async (socket, next) => {
      // Path 1: Display token (non-JWT, DB lookup)
      const displayToken = socket.handshake.auth.displayToken;
      if (displayToken) {
        if (!this.displayManager) {
          return next(new Error('Display authentication not available'));
        }
        try {
          const competitionId = await this.displayManager.verifyToken(displayToken);
          if (competitionId) {
            socket.isDisplay = true;
            socket.user = { role: 'DISPLAY', competitionId, userId: null };
            return next();
          }
          return next(new Error('Invalid display token'));
        } catch (e) {
          return next(new Error('Invalid display token'));
        }
      }

      // Path 2: JWT (existing logic — unchanged)
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication required'));
      try {
        const decoded = jwt.verify(token, config.JWT_SECRET);
        socket.user = decoded;
        socket.isDisplay = false;
        next();
      } catch (e) {
        next(new Error('Invalid token'));
      }
    });
  }

  // ─── Connection handling ───────────────────────────────────────

  _setupConnection() {
    this.io.on('connection', (socket) => {
      // Display socket: minimal handling, no game logic
      if (socket.isDisplay) {
        this._handleDisplayConnection(socket);
        return;
      }

      console.log(`User connected: ${socket.user.username} (${socket.user.role})`);

      // Join user-specific room for targeted messages
      socket.join(`user_${socket.user.userId}`);

      // Heartbeat interval for active player tracking
      let heartbeatInterval = null;

      // Per-connection rate limiter (token bucket)
      const rateLimiter = this._createRateLimiter();

      // ─── Room management ─────────────────────────────────────

      socket.on('join_room', async (data) => {
        const parsed = this._validate(joinRoomSchema, data, socket, 'join_room');
        if (!parsed) return;
        const { competitionId } = parsed;
        try {
          socket.join(`competition_${competitionId}`);
          console.log(`${socket.user.username} joined competition ${competitionId}`);

          // If player, also join team room
          let teamId = null;
          if (socket.user.role === 'PLAYER') {
            const member = await this.repos.teams.findMemberTeam(competitionId, socket.user.userId);
            if (member) {
              socket.join(`team_${competitionId}_${member.team_id}`);
              teamId = member.team_id;
            }
          }

          // Track active player
          await this.orchestrator.state.setActivePlayer(competitionId, socket.user.userId, socket.id);

          // Start heartbeat for active player tracking
          if (socket.user.role === 'PLAYER') {
            heartbeatInterval = setInterval(async () => {
              await this.orchestrator.state.refreshHeartbeat(competitionId, socket.user.userId);
            }, config.HEARTBEAT_INTERVAL_MS);
          }

          // Notify room of status change (legacy + new monitoring event)
          this.io.to(`competition_${competitionId}`).emit('event', {
            type: 'PLAYER_STATUS_CHANGE',
            timestamp: new Date().toISOString(),
            competitionId,
            payload: { playerId: socket.user.userId, playerName: socket.user.username, online: true }
          });

          // Register with PresenceService for stale-heartbeat monitoring
          if (this.presenceService) {
            this.presenceService.addCompetition(competitionId);
          }

          // Emit full participant list update to judges
          await this._emitParticipantListUpdate(competitionId);

          // Late-join sync via orchestrator
          if (socket.user.role === 'PLAYER') {
            await this._handleLateJoin(socket, competitionId);
          }
        } catch (e) {
          console.error('join_room error:', e.message);
        }
      });

      socket.on('leave_room', async (data) => {
        const parsed = this._validate(leaveRoomSchema, data, socket, 'leave_room');
        if (!parsed) return;
        const { competitionId } = parsed;
        try {
          socket.leave(`competition_${competitionId}`);
          // Leave all team rooms for this competition
          const rooms = [...socket.rooms];
          for (const room of rooms) {
            if (room.startsWith(`team_${competitionId}_`)) {
              socket.leave(room);
            }
          }
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
          await this.orchestrator.state.removeActivePlayer(competitionId, socket.user.userId);

          // Emit offline status change for monitoring
          this.io.to(`competition_${competitionId}`).emit('event', {
            type: 'PARTICIPANT_STATUS_CHANGE',
            timestamp: new Date().toISOString(),
            competitionId,
            payload: { userId: socket.user.userId, status: 'offline' }
          });

          // Emit full participant list update to judges
          await this._emitParticipantListUpdate(competitionId);

          console.log(`${socket.user.username} left competition ${competitionId}`);
        } catch (e) {
          console.error('leave_room error:', e.message);
        }
      });

      // ─── Game actions ────────────────────────────────────────

      socket.on('cell_fill', async (data) => {
        if (!this._checkRateLimit(rateLimiter, socket, 'cell_fill')) return;
        const parsed = this._validate(cellFillSchema, data, socket, 'cell_fill');
        if (!parsed) return;
        try {
          const { competitionId, roundId, puzzleId, row, col, value } = parsed;
          const { result, emissions } = await this.orchestrator.handleCellFill(
            socket.user.userId, competitionId, roundId, puzzleId, row, col, value
          );
          this.orchestrator.bus.emitAll(emissions);
          socket.emit('event', {
            type: result.success ? 'CELL_FILL_ACK' : 'CELL_CONFLICT',
            timestamp: new Date().toISOString(),
            payload: result.success ? { row, col, value } : { message: result.message }
          });
        } catch (e) {
          socket.emit('event', {
            type: 'CELL_FILL_ERROR',
            timestamp: new Date().toISOString(),
            payload: { message: e.message }
          });
        }
      });

      socket.on('answer_submit', async (data) => {
        if (!this._checkRateLimit(rateLimiter, socket, 'answer_submit')) return;
        const parsed = this._validate(answerSubmitSchema, data, socket, 'answer_submit');
        if (!parsed) return;
        try {
          const { competitionId, roundId, puzzleId, submissionType, row, col, value, grid } = parsed;
          const { result, emissions } = await this.orchestrator.submitAnswer(
            socket.user.userId, roundId, puzzleId, submissionType, { row, col, value, grid }
          );
          this.orchestrator.bus.emitAll(emissions);
          socket.emit('event', {
            type: 'ANSWER_RESULT',
            timestamp: new Date().toISOString(),
            payload: result
          });
        } catch (e) {
          socket.emit('event', {
            type: 'ANSWER_ERROR',
            timestamp: new Date().toISOString(),
            payload: { message: e.message }
          });
        }
      });

      socket.on('player_move', async (data) => {
        if (!this._checkRateLimit(rateLimiter, socket, 'player_move')) return;
        try {
          const { roundId, puzzleId, row, col, value } = data;
          const userId = socket.user.userId;
          const prisma = getPrisma();

          // Find player record
          const player = await prisma.players.findFirst({
            where: { competition_id: data.competitionId, user_id: userId },
          });
          if (!player) {
            socket.emit('event', {
              type: 'PLAYER_MOVE_ERROR',
              timestamp: new Date().toISOString(),
              payload: { message: '未找到参赛者记录' }
            });
            return;
          }

          // Get current grid from state repository
          let grid = await this.orchestrator.state.getIndividualPlayerGrid(roundId, player.id, puzzleId);

          // If no grid exists yet, fetch from puzzle_answers using actual session UUID
          if (!grid) {
            const session = await prisma.player_round_sessions.findUnique({
              where: {
                round_id_participant_id: {
                  round_id: roundId,
                  participant_id: player.id,
                },
              },
            });

            if (session) {
              const answer = await prisma.puzzle_answers.findFirst({
                where: {
                  session_id: session.id,
                  puzzle_id: puzzleId,
                },
              });
              if (answer) {
                grid = typeof answer.current_grid === 'string'
                  ? JSON.parse(answer.current_grid)
                  : answer.current_grid;
              }
            }
          }

          // Apply the move
          if (grid) {
            grid[row][col] = value;
            await this.orchestrator.state.setIndividualPlayerGrid(roundId, player.id, puzzleId, grid);

            socket.emit('event', {
              type: 'PLAYER_MOVE_ACK',
              timestamp: new Date().toISOString(),
              payload: { success: true, row, col, value }
            });

            // Emit throttled PLAYER_GRID_UPDATE to judges for real-time monitoring
            this._emitPlayerGridUpdate(data.competitionId, player.id, puzzleId, grid);
          } else {
            socket.emit('event', {
              type: 'PLAYER_MOVE_ERROR',
              timestamp: new Date().toISOString(),
              payload: { message: '未找到答题记录' }
            });
          }
        } catch (e) {
          socket.emit('event', {
            type: 'PLAYER_MOVE_ERROR',
            timestamp: new Date().toISOString(),
            payload: { message: e.message }
          });
        }
      });

      socket.on('round2_cell_update', async (data) => {
        if (!this._checkRateLimit(rateLimiter, socket, 'round2_cell_update')) return;
        try {
          const { roundId, puzzleId, row, col, value } = data;
          const { result, emissions } = await this.orchestrator.round2CellUpdate(
            socket.user.userId, roundId, puzzleId, row, col, value
          );
          this.orchestrator.bus.emitAll(emissions);
          socket.emit('event', {
            type: 'ROUND2_CELL_ACK',
            timestamp: new Date().toISOString(),
            payload: { success: true, row, col, value }
          });
        } catch (e) {
          socket.emit('event', {
            type: 'ROUND2_CELL_ERROR',
            timestamp: new Date().toISOString(),
            payload: { message: e.message }
          });
        }
      });

      // ─── Round 3 collaboration events ──────────────────────────>

      socket.on('round3_propose', async (data) => {
        if (!this._checkRateLimit(rateLimiter, socket, 'round3_propose')) return;
        try {
          const { competitionId, roundId, puzzleId, row, col, value } = data;
          const { result, emissions } = await this.orchestrator.round3ProposeCell(
            socket.user.userId, competitionId, roundId, puzzleId, row, col, value
          );
          this.orchestrator.bus.emitAll(emissions);
          socket.emit('event', {
            type: 'ROUND3_PROPOSE_ACK',
            timestamp: new Date().toISOString(),
            payload: result
          });
        } catch (e) {
          socket.emit('event', {
            type: 'ROUND3_PROPOSE_ERROR',
            timestamp: new Date().toISOString(),
            payload: { message: e.message }
          });
        }
      });

      socket.on('round3_accept', async (data) => {
        if (!this._checkRateLimit(rateLimiter, socket, 'round3_accept')) return;
        try {
          const { competitionId, roundId, puzzleId, row, col } = data;
          const { result, emissions } = await this.orchestrator.round3AcceptProposal(
            socket.user.userId, competitionId, roundId, puzzleId, row, col
          );
          this.orchestrator.bus.emitAll(emissions);
          socket.emit('event', {
            type: 'ROUND3_ACCEPT_ACK',
            timestamp: new Date().toISOString(),
            payload: result
          });
        } catch (e) {
          socket.emit('event', {
            type: 'ROUND3_ACCEPT_ERROR',
            timestamp: new Date().toISOString(),
            payload: { message: e.message }
          });
        }
      });

      socket.on('round3_reject', async (data) => {
        if (!this._checkRateLimit(rateLimiter, socket, 'round3_reject')) return;
        try {
          const { competitionId, roundId, puzzleId, row, col } = data;
          const { result, emissions } = await this.orchestrator.round3RejectProposal(
            socket.user.userId, competitionId, roundId, puzzleId, row, col
          );
          this.orchestrator.bus.emitAll(emissions);
          socket.emit('event', {
            type: 'ROUND3_REJECT_ACK',
            timestamp: new Date().toISOString(),
            payload: result
          });
        } catch (e) {
          socket.emit('event', {
            type: 'ROUND3_REJECT_ERROR',
            timestamp: new Date().toISOString(),
            payload: { message: e.message }
          });
        }
      });

      socket.on('round3_withdraw', async (data) => {
        if (!this._checkRateLimit(rateLimiter, socket, 'round3_withdraw')) return;
        try {
          const { competitionId, roundId, puzzleId, row, col } = data;
          const { result, emissions } = await this.orchestrator.round3WithdrawProposal(
            socket.user.userId, competitionId, roundId, puzzleId, row, col
          );
          this.orchestrator.bus.emitAll(emissions);
          socket.emit('event', {
            type: 'ROUND3_WITHDRAW_ACK',
            timestamp: new Date().toISOString(),
            payload: result
          });
        } catch (e) {
          socket.emit('event', {
            type: 'ROUND3_WITHDRAW_ERROR',
            timestamp: new Date().toISOString(),
            payload: { message: e.message }
          });
        }
      });

      socket.on('round3_focus', async (data) => {
        if (!this._checkRateLimit(rateLimiter, socket, 'round3_focus')) return;
        try {
          const { competitionId, roundId, puzzleId, row, col } = data;
          const { result, emissions } = await this.orchestrator.round3FocusUpdate(
            socket.user.userId, competitionId, roundId, puzzleId, row, col
          );
          this.orchestrator.bus.emitAll(emissions);
        } catch (e) {
          // Focus updates are non-critical, no error response needed
        }
      });

      // ─── Heartbeat ───────────────────────────────────────────

      socket.on('heartbeat', () => {
        // Active player tracking is handled by the interval above
      });

      // ─── Disconnect ──────────────────────────────────────────

      socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.user.username}`);
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        // Note: we don't immediately remove active player on disconnect
        // because the player may reconnect shortly. The PresenceService
        // sweep will detect stale heartbeats and emit PARTICIPANT_STATUS_CHANGE
        // offline events once the TTL expires.

        // Clean up R3 player focus on disconnect so stale focus doesn't persist
        try {
          // Find all competition rooms this socket was in.
          //
          // This pattern used to be /^tournament_(\d+)$/ followed by
          // parseInt(). Both halves dated from the SERIAL era: ids are UUIDs,
          // which \d+ never matches, so this cleanup had been silently dead
          // since the UUID migration. Renaming the room prefix forced the
          // pattern to be rewritten, and a pattern that cannot match is not
          // worth keeping — so it now captures the UUID and passes it through
          // unconverted.
          const rooms = [...socket.rooms];
          for (const room of rooms) {
            const match = room.match(/^competition_(.+)$/);
            if (match) {
              this.orchestrator.clearRound3PlayerFocus(socket.user.userId, match[1]);
            }
          }
        } catch (_) { /* non-critical */ }
      });
    });
  }

  // ─── Late-join sync ───────────────────────────────────────────

  async _handleLateJoin(socket, competitionId) {
    try {
      const reconnectState = await this.orchestrator.getReconnectState(socket.user.userId, competitionId);
      if (!reconnectState || !reconnectState.currentRound) return;

      const { currentRound, puzzles, round1Progress, round2State } = reconnectState;
      const competitionIdStr = String(competitionId);

      // 1. Send ROUND_STARTED
      socket.emit('event', {
        type: 'ROUND_STARTED',
        timestamp: new Date().toISOString(),
        competitionId: competitionIdStr,
        payload: {
          roundId: currentRound.roundId,
          roundNumber: currentRound.roundNumber,
          roundName: currentRound.roundName,
          roundType: currentRound.roundType,
          durationSeconds: currentRound.durationSeconds,
          totalPuzzles: puzzles.length,
          turnEndsAt: currentRound.turnEndsAt,
          timerStatus: currentRound.timerStatus
        }
      });

      // 2. Send PUZZLE_ASSIGN
      if (puzzles.length > 0) {
        socket.emit('event', {
          type: 'PUZZLE_ASSIGN',
          timestamp: new Date().toISOString(),
          payload: { roundId: currentRound.roundId, puzzles }
        });
      }

      // 3. Send TIMER_TICK with server-authoritative turnEndsAt
      socket.emit('event', {
        type: 'TIMER_TICK',
        timestamp: new Date().toISOString(),
        competitionId: competitionIdStr,
        payload: {
          roundId: currentRound.roundId,
          remainingSeconds: currentRound.remainingSeconds,
          totalSeconds: currentRound.durationSeconds,
          turnEndsAt: currentRound.turnEndsAt,
          timerStatus: currentRound.timerStatus
        }
      });

      // 4. Round 2 specific state
      if (currentRound.roundType === 'ROUND2_RELAY' && round2State) {
        socket.emit('event', {
          type: 'ROUND2_STARTED',
          timestamp: new Date().toISOString(),
          payload: {
            roundId: currentRound.roundId,
            playerOrder: round2State.playerOrder,
            playerNames: round2State.playerNames,
            puzzles: round2State.puzzles,
            assignedPuzzleId: round2State.assignedPuzzleId,
            assignedPuzzle: round2State.assignedPuzzle,
            rotationInterval: round2State.rotationInterval,
            nextRotationAt: round2State.nextRotationAt,
            teamScore: round2State.teamScore,
            solvedCount: round2State.solvedCount,
            totalPuzzles: round2State.totalPuzzles
          }
        });
      }

      // 5. Round 3 specific state (collaboration sync)
      if (currentRound.roundType === 'ROUND3_COLLABORATE' && reconnectState.round3State) {
        const r3 = reconnectState.round3State;

        // Build teamMembers list from team membership + active players
        let teamMembers = [];
        const member = await this.repos.teams.findMemberTeam(competitionId, socket.user.userId);
        if (member) {
          const allMembers = await this.repos.teams.getMembersWithDetails(member.team_id);
          const activePlayers = await this.orchestrator.state.getActivePlayers(competitionId);
          teamMembers = (allMembers || []).map(m => ({
            playerId: String(m.player_id),
            playerName: m.display_name || `Player ${m.player_id}`,
            online: !!activePlayers[String(m.player_id)]
          }));
        }

        socket.emit('event', {
          type: 'ROUND3_STATE_SYNC',
          timestamp: new Date().toISOString(),
          payload: {
            roundId: currentRound.roundId,
            puzzles: r3.puzzles || [],
            currentPuzzleId: r3.currentPuzzleId,
            cells: r3.cells || {},
            suggestions: r3.suggestions || {},
            playerFocuses: r3.playerFocuses || {},
            suggestionVotes: r3.suggestionVotes || {},
            teamMembers,
            teamScore: r3.teamScore || 0,
            solvedCount: r3.solvedCount || 0,
            totalPuzzles: r3.totalPuzzles || 0
          }
        });
      }

      // 6. Round 1 specific progress
      // 6. Round 1 specific progress
      if (currentRound.roundType === 'ROUND1_NINE_ONE' && round1Progress) {
        // Replay solved JOC puzzles
        for (const solved of round1Progress.solvedPuzzles || []) {
          socket.emit('event', {
            type: 'ROUND1_PUZZLE_SOLVED',
            timestamp: new Date().toISOString(),
            competitionId: competitionIdStr,
            payload: {
              roundId: currentRound.roundId,
              puzzleId: solved.puzzleId,
              solvedBy: null,
              solvedByName: '(reconnected)',
              letter: solved.letter,
              puzzlePoints: 0,
              totalRound1Score: 0
            }
          });
        }

        // Send final unlock if applicable
        if (round1Progress.finalUnlocked) {
          socket.emit('event', {
            type: 'ROUND1_FINAL_UNLOCKED',
            timestamp: new Date().toISOString(),
            competitionId: competitionIdStr,
            payload: {
              roundId: currentRound.roundId,
              clues: round1Progress.clues,
              finalPuzzleId: round1Progress.finalPuzzleId,
              finalPuzzle: round1Progress.finalPuzzle
            }
          });
        }

        // Send score update
        if (round1Progress.teamScore > 0) {
          const member = await this.repos.teams.findMemberTeam(competitionId, socket.user.userId);
          if (member) {
            socket.emit('event', {
              type: 'SCORE_UPDATE',
              timestamp: new Date().toISOString(),
              competitionId: competitionIdStr,
              payload: {
                roundId: currentRound.roundId,
                teamId: member.team_id,
                teamTotalPoints: round1Progress.teamScore
              }
            });
          }
        }
      }
    } catch (e) {
      console.error('Late-join sync error:', e.message);
    }
  }
}

module.exports = SocketManager;
