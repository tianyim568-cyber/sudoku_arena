import { translateServerMessage } from '../i18n/serverMessages';

const API_BASE = '/api';

let token = localStorage.getItem('token');

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem('token', t);
  else localStorage.removeItem('token');
}

export function getToken() {
  return token;
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const json = await res.json();
  // Translate server-originated (Chinese) messages to the current language.
  if (json && typeof json.message === 'string') {
    const lang = localStorage.getItem('sa_lang') === 'en' ? 'en' : 'zh';
    json.message = translateServerMessage(json.message, lang);
  }
  return json;
}

async function uploadFile(path, file) {
  const formData = new FormData();
  formData.append('file', file);
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Do NOT set Content-Type — browser sets multipart boundary automatically
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: formData });
  const json = await res.json();
  if (json && typeof json.message === 'string') {
    const lang = localStorage.getItem('sa_lang') === 'en' ? 'en' : 'zh';
    json.message = translateServerMessage(json.message, lang);
  }
  return json;
}

export const api = {
  // Auth
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  getMe: () => request('GET', '/auth/me'),

  // Tournaments
  listTournaments: () => request('GET', '/tournaments'),
  getTournament: (id) => request('GET', `/tournaments/${id}`),
  createTournament: (data) => request('POST', '/tournaments', data),
  updateTournament: (id, data) => request('PUT', `/tournaments/${id}`, data),
  deleteTournament: (id) => request('DELETE', `/tournaments/${id}`),

  // Rounds
  listRounds: (tournamentId) => request('GET', `/tournaments/${tournamentId}/rounds`),
  createRound: (tournamentId, data) => request('POST', `/tournaments/${tournamentId}/rounds`, data),

  // Puzzles
  importPuzzles: (roundId, puzzles) => request('POST', `/rounds/${roundId}/puzzles/import`, { puzzles }),
  listPuzzles: (roundId) => request('GET', `/rounds/${roundId}/puzzles`),

  // Teams
  listTeams: (tournamentId) => request('GET', `/tournaments/${tournamentId}/teams`),
  createTeam: (tournamentId, name) => request('POST', `/tournaments/${tournamentId}/teams`, { name }),
  addTeamMember: (teamId, playerId, position) => request('POST', '/teams/' + teamId + '/members', { playerId, position }),

  // Judges
  assignJudge: (tournamentId, judgeId) => request('POST', `/tournaments/${tournamentId}/judges`, { judgeId }),

  // Game control
  startTournament: (id) => request('POST', `/tournaments/${id}/start`),
  pauseTournament: (id) => request('POST', `/tournaments/${id}/pause`),
  resumeTournament: (id) => request('POST', `/tournaments/${id}/resume`),
  endTournament: (id) => request('POST', `/tournaments/${id}/end`),
  startRound: (tournamentId, roundId) => request('POST', `/tournaments/${tournamentId}/rounds/${roundId}/start`),
  endRound: (tournamentId, roundId) => request('POST', `/tournaments/${tournamentId}/rounds/${roundId}/end`),

  // Scores
  getMyScores: (tournamentId) => request('GET', `/tournaments/${tournamentId}/scores/my`),
  getTeamScores: (tournamentId) => request('GET', `/tournaments/${tournamentId}/scores/teams`),

  // Room status
  getRoomStatus: (tournamentId) => request('GET', `/tournaments/${tournamentId}/room/status`),

  // Player game state (REST fallback)
  getMyGameState: (tournamentId) => request('GET', `/tournaments/${tournamentId}/my-state`),

  // Puzzle Bank
  generatePuzzles: (roundType, teamsCount) => request('POST', '/puzzle-bank/generate', { roundType, teamsCount }),
  generatePuzzlesBulk: (teamsCount) => request('POST', '/puzzle-bank/generate-bulk', { teamsCount }),
  importPuzzlesToRound: (roundId, teamsCount) => request('POST', '/puzzle-bank/import-to-round', { roundId, teamsCount }),
  deletePuzzleFromBank: (id) => request('DELETE', `/puzzle-bank/${id}`),
  clearPuzzleBank: () => request('DELETE', '/puzzle-bank'),

  // Users
  listUsers: () => request('GET', '/users'),

  // Participants (import)
  uploadParticipants: (tournamentId, file) => uploadFile(`/tournaments/${tournamentId}/participants/upload`, file),
  confirmParticipants: (tournamentId, rows) => request('POST', `/tournaments/${tournamentId}/participants/confirm`, { rows }),
  listParticipants: (tournamentId) => request('GET', `/tournaments/${tournamentId}/participants`),
  deleteParticipants: (tournamentId) => request('DELETE', `/tournaments/${tournamentId}/participants`),

  // Export participants with credentials
  exportParticipants: async (tournamentId) => {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/tournaments/${tournamentId}/participants/export`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new Error(json?.message || 'Export failed');
    }

    // Get filename from Content-Disposition header or use default
    const contentDisposition = res.headers.get('Content-Disposition');
    let filename = 'participants_credentials.xlsx';
    if (contentDisposition) {
      const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
      if (match) filename = decodeURIComponent(match[1].replace(/"/g, ''));
    }

    // Create blob and trigger download
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    return { success: true, filename };
  },

  // Generic request (for endpoints not covered above)
  request,
};
