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

// Read the response as JSON. A missing route (404) or a crashed server answers
// with HTML or an empty body, which would make res.json() throw a cryptic
// "JSON.parse: unexpected end of data". Fall back to the standard envelope so
// callers can always rely on { code, message }.
async function parseResponse(res) {
  const text = await res.text();
  if (!text) {
    return { code: res.status, message: `HTTP ${res.status}`, data: null };
  }
  try {
    return JSON.parse(text);
  } catch {
    return { code: res.status, message: `HTTP ${res.status}`, data: null };
  }
}

function translateMessage(json) {
  if (json && typeof json.message === 'string') {
    const lang = localStorage.getItem('sa_lang') === 'en' ? 'en' : 'zh';
    json.message = translateServerMessage(json.message, lang);
  }
  return json;
}

// A rejected fetch (server down, DNS failure, connection reset) never produced
// an envelope, so callers that only inspect `res.code` saw an unhandled
// rejection and rendered nothing at all. Every failure mode now returns
// { code, message }, so a caller can always report a reason.
const NETWORK_ERROR_CODE = 0;

function networkErrorEnvelope(e) {
  return { code: NETWORK_ERROR_CODE, message: `Network error: ${e.message}`, data: null };
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, opts);
  } catch (e) {
    return networkErrorEnvelope(e);
  }
  // Translate server-originated (Chinese) messages to the current language.
  return translateMessage(await parseResponse(res));
}

async function uploadFile(path, file) {
  const formData = new FormData();
  formData.append('file', file);
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // Do NOT set Content-Type — browser sets multipart boundary automatically
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: formData });
  } catch (e) {
    return networkErrorEnvelope(e);
  }
  return translateMessage(await parseResponse(res));
}

export const api = {
  // Auth
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  register: (organizationName, adminUsername, password) =>
    request('POST', '/auth/register', { organizationName, adminUsername, password }),
  getMe: () => request('GET', '/auth/me'),

  // Competitions (renamed from "Competitions" in Phase 6 of the migration).
  // No compatibility aliases — the old names are intentionally gone so that
  // stale callers fail loudly instead of silently hitting a 404.
  listCompetitions: () => request('GET', '/competitions'),
  getCompetition: (id) => request('GET', `/competitions/${id}`),
  createCompetition: (data) => request('POST', '/competitions', data),
  updateCompetition: (id, data) => request('PUT', `/competitions/${id}`, data),
  deleteCompetition: (id) => request('DELETE', `/competitions/${id}`),

  // Stages — a competition is a sequence of stages (INDIVIDUAL / TEAM / PK),
  // each holding its own rounds.
  //
  // configureStages is DECLARATIVE, not incremental: the server compares the
  // list it receives against what is stored, then creates, updates and DELETES
  // to match. Always send the complete desired list — sending only the new
  // stage would wipe every other one, along with its rounds.
  listStages: (competitionId) => request('GET', `/competitions/${competitionId}/stages`),
  configureStages: (competitionId, stages) => request('PUT', `/competitions/${competitionId}/stages`, { stages }),

  // Which round types each stage category accepts. Served by the API rather
  // than duplicated here, so the dropdown cannot offer something the server
  // would reject. Shape: { TEAM: [...], INDIVIDUAL: [...], PK: [] }.
  getRoundTypes: () => request('GET', '/round-types'),

  // A round belongs to a stage, never directly to a competition.
  createStageRound: (competitionId, stageId, data) =>
    request('POST', `/competitions/${competitionId}/stages/${stageId}/rounds`, data),

  // Rounds — the path now speaks `/competitions`, but the JS parameter keeps
  // the historical name `competitionId` for now. Renaming it would ripple into
  // every caller page and is out of scope for Phase 6. See JOURNAL_MODIFICATIONS.
  listRounds: (competitionId) => request('GET', `/competitions/${competitionId}/rounds`),

  // Puzzles
  importPuzzles: (roundId, puzzles) => request('POST', `/rounds/${roundId}/puzzles/import`, { puzzles }),
  listPuzzles: (roundId) => request('GET', `/rounds/${roundId}/puzzles`),

  // Teams
  listTeams: (competitionId) => request('GET', `/competitions/${competitionId}/teams`),
  createTeam: (competitionId, name) => request('POST', `/competitions/${competitionId}/teams`, { name }),
  addTeamMember: (teamId, playerId, position) => request('POST', '/teams/' + teamId + '/members', { playerId, position }),

  // Judges
  assignJudge: (competitionId, judgeId) => request('POST', `/competitions/${competitionId}/judges`, { judgeId }),

  // Game control — Phase 10: paths migrated to /competitions, functions renamed
  // to match. The orchestrator methods on the server keep their historical
  // names (startCompetition, etc.) — only the HTTP layer speaks "competition".
  startCompetition: (id) => request('POST', `/competitions/${id}/start`),
  pauseCompetition: (id) => request('POST', `/competitions/${id}/pause`),
  resumeCompetition: (id) => request('POST', `/competitions/${id}/resume`),
  endCompetition: (id) => request('POST', `/competitions/${id}/end`),
  startRound: (competitionId, roundId) => request('POST', `/competitions/${competitionId}/rounds/${roundId}/start`),
  endRound: (competitionId, roundId) => request('POST', `/competitions/${competitionId}/rounds/${roundId}/end`),

  // Scores
  getMyScores: (competitionId) => request('GET', `/competitions/${competitionId}/scores/my`),
  getTeamScores: (competitionId) => request('GET', `/competitions/${competitionId}/scores/teams`),

  // Room status
  getRoomStatus: (competitionId) => request('GET', `/competitions/${competitionId}/room/status`),

  // Player game state (REST fallback)
  getMyGameState: (competitionId) => request('GET', `/competitions/${competitionId}/my-state`),

  // Puzzle Bank
  generatePuzzles: (roundType, teamsCount) => request('POST', '/puzzle-bank/generate', { roundType, teamsCount }),
  generatePuzzlesBulk: (teamsCount) => request('POST', '/puzzle-bank/generate-bulk', { teamsCount }),
  importPuzzlesToRound: (roundId, teamsCount) => request('POST', '/puzzle-bank/import-to-round', { roundId, teamsCount }),
  deletePuzzleFromBank: (id) => request('DELETE', `/puzzle-bank/${id}`),
  clearPuzzleBank: () => request('DELETE', '/puzzle-bank'),

  // Users
  listUsers: () => request('GET', '/users'),

  // Participants (import)
  uploadParticipants: (competitionId, file) => uploadFile(`/competitions/${competitionId}/participants/upload`, file),
  confirmParticipants: (competitionId, rows) => request('POST', `/competitions/${competitionId}/participants/confirm`, { rows }),
  listParticipants: (competitionId) => request('GET', `/competitions/${competitionId}/participants`),
  deleteParticipants: (competitionId) => request('DELETE', `/competitions/${competitionId}/participants`),

  // Export participants with credentials. This endpoint returns a binary XLSX
  // blob, not JSON, so it cannot go through request() — but we still wrap the
  // fetch so a network failure (server down, DNS) returns an envelope
  // { success: false, message } instead of throwing an unhandled rejection.
  exportParticipants: async (competitionId) => {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let res;
    try {
      res = await fetch(`${API_BASE}/competitions/${competitionId}/participants/export`, {
        method: 'GET',
        headers,
      });
    } catch (e) {
      return { success: false, message: `Network error: ${e.message}` };
    }

    if (!res.ok) {
      const json = await res.json().catch(() => null);
      return { success: false, message: json?.message || 'Export failed' };
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

  // Competition access
  getCompetitionByCode: (accessCode) => request('GET', `/competitions/by-code/${accessCode}/info`),
  competitionLogin: (identifier, username, password) =>
    request('POST', `/competitions/by-code/${identifier}/login`, { username, password }),

  // Display token management (ORG_ADMIN)
  generateDisplayToken: (competitionId) => request('POST', `/competitions/${competitionId}/display-token`),
  revokeDisplayToken: (competitionId) => request('DELETE', `/competitions/${competitionId}/display-token`),

  // Competition access links (ORG_ADMIN)
  generateAccessLink: (competitionId) => request('POST', `/competitions/${competitionId}/access-link`),
  getAccessLink: (competitionId) => request('GET', `/competitions/${competitionId}/access-link`),
  revokeAccessLink: (competitionId) => request('DELETE', `/competitions/${competitionId}/access-link`),

  // Generic request (for endpoints not covered above)
  request,
};
