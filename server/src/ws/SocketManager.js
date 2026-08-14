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
  constructor(io, repos, orchestrator, bus) {
    this.io = io;
    this.repos = repos;
    this.orchestrator = orchestrator;

    // Subscribe to EmissionBus — both queued and immediate emissions
    bus.on('emission', (e) => this._routeEmission(e));
    bus.on('immediate', (e) => this._routeEmission(e));

    this._setupAuth();
    this._setupConnection();
  }

  // ─── Emission routing ─────────────────────────────────────────

  _routeEmission(e) {
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
    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication required'));
      try {
        const decoded = jwt.verify(token, config.JWT_SECRET);
        socket.user = decoded;
        next();
      } catch (e) {
        next(new Error('Invalid token'));
      }
    });
  }

  // ─── Connection handling ───────────────────────────────────────

  _setupConnection() {
    this.io.on('connection', (socket) => {
      console.log(`User connected: ${socket.user.username} (${socket.user.role})`);

      // Join user-specific room for targeted messages
      socket.join(`user_${socket.user.userId}`);

      // Heartbeat interval for active player tracking
      let heartbeatInterval = null;

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
              await this.orchestrator.state.setActivePlayer(competitionId, socket.user.userId, socket.id);
            }, config.HEARTBEAT_INTERVAL_MS);
          }

          // Notify room
          this.io.to(`competition_${competitionId}`).emit('event', {
            type: 'PLAYER_STATUS_CHANGE',
            timestamp: new Date().toISOString(),
            competitionId,
            payload: { playerId: socket.user.userId, playerName: socket.user.username, online: true }
          });

          // Late-join sync via orchestrator
          if (socket.user.role === 'PLAYER') {
            await this._handleLateJoin(socket, competitionId);
          }
        } catch (e) {
          console.error('join_room error:', e.message);
        }
      });

      socket.on('leave_room', (data) => {
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
          this.orchestrator.state.removeActivePlayer(competitionId, socket.user.userId);
          console.log(`${socket.user.username} left competition ${competitionId}`);
        } catch (e) {
          console.error('leave_room error:', e.message);
        }
      });

      // ─── Game actions ────────────────────────────────────────

      socket.on('cell_fill', async (data) => {
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

          // If no grid exists yet, fetch from puzzle_answers
          if (!grid) {
            const answer = await prisma.puzzle_answers.findFirst({
              where: {
                session_id: `${roundId}_${player.id}`,
                puzzle_id: puzzleId,
              },
            });
            if (answer) {
              grid = typeof answer.current_grid === 'string'
                ? JSON.parse(answer.current_grid)
                : answer.current_grid;
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
        // because the player may reconnect shortly. The TTL will clean up.

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
