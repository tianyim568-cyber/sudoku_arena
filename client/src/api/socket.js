import { io } from 'socket.io-client';
import { getToken } from '../api';

let socket = null;
let currentCompetitionId = null;

export function connectSocket() {
  if (socket?.connected) return socket;
  const token = getToken();
  if (!token) return null;

  socket = io('/', {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', () => {
    console.log('WebSocket connected');
    // Auto-rejoin room on reconnect
    if (currentCompetitionId) {
      socket.emit('join_room', { competitionId: currentCompetitionId });
    }
  });

  socket.on('disconnect', () => {
    console.log('WebSocket disconnected');
  });

  socket.on('connect_error', (err) => {
    console.error('WebSocket error:', err.message);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    currentCompetitionId = null;
  }
}

export function getSocket() {
  return socket;
}

export function joinRoom(competitionId) {
  currentCompetitionId = competitionId;
  socket?.emit('join_room', { competitionId });
}

export function leaveRoom(competitionId) {
  if (currentCompetitionId === competitionId) currentCompetitionId = null;
  socket?.emit('leave_room', { competitionId });
}

export function submitCellFill(competitionId, roundId, puzzleId, row, col, value) {
  socket?.emit('cell_fill', { competitionId, roundId, puzzleId, row, col, value });
}

export function submitAnswer(competitionId, roundId, puzzleId, submissionType, data) {
  socket?.emit('answer_submit', { competitionId, roundId, puzzleId, submissionType, ...data });
}

export function round2CellUpdate(roundId, puzzleId, row, col, value) {
  socket?.emit('round2_cell_update', { roundId, puzzleId, row, col, value });
}

export function playerMove(competitionId, roundId, puzzleId, row, col, value) {
  socket?.emit('player_move', { competitionId, roundId, puzzleId, row, col, value });
}

// ─── Round 3 collaboration events ────────────────────────────

export function round3ProposeCell(competitionId, roundId, puzzleId, row, col, value) {
  socket?.emit('round3_propose', { competitionId, roundId, puzzleId, row, col, value });
}

export function round3AcceptProposal(competitionId, roundId, puzzleId, row, col) {
  socket?.emit('round3_accept', { competitionId, roundId, puzzleId, row, col });
}

export function round3RejectProposal(competitionId, roundId, puzzleId, row, col) {
  socket?.emit('round3_reject', { competitionId, roundId, puzzleId, row, col });
}

export function round3WithdrawProposal(competitionId, roundId, puzzleId, row, col) {
  socket?.emit('round3_withdraw', { competitionId, roundId, puzzleId, row, col });
}

export function round3FocusUpdate(competitionId, roundId, puzzleId, row, col) {
  socket?.emit('round3_focus', { competitionId, roundId, puzzleId, row, col });
}

export function onEvent(callback) {
  socket?.on('event', callback);
  return () => socket?.off('event', callback);
}

// ─── Display socket (token-based, separate from game socket) ───

let displaySocket = null;

/**
 * Open a Socket.IO connection using a display access token.
 * The server authenticates via DB lookup (no JWT) and auto-joins
 * the display_${competitionId} room.
 * @param {string} displayToken — from the display page URL
 * @returns {import('socket.io-client').Socket}
 */
export function connectDisplaySocket(displayToken) {
  if (displaySocket?.connected) return displaySocket;

  displaySocket = io('/', {
    auth: { displayToken },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  displaySocket.on('connect', () => {
    console.log('Display WebSocket connected');
  });

  displaySocket.on('disconnect', () => {
    console.log('Display WebSocket disconnected');
  });

  displaySocket.on('connect_error', (err) => {
    console.error('Display WebSocket error:', err.message);
  });

  return displaySocket;
}

export function disconnectDisplaySocket() {
  if (displaySocket) {
    displaySocket.disconnect();
    displaySocket = null;
  }
}

export function onDisplayEvent(callback) {
  displaySocket?.on('event', callback);
  return () => displaySocket?.off('event', callback);
}

/**
 * Returns true when the display WebSocket is connected.
 * The DisplayPage uses this to decide whether to poll via HTTP.
 */
export function isDisplaySocketConnected() {
  return displaySocket?.connected ?? false;
}
