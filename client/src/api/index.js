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
  // Reuses the big-screen ranking snapshot behind admin auth — admin and
  // big screen always see the same numbers. Optional categoryId query param
  // — omit for all categories. Mirrors the display page's fetchRanking so
  // admin and big screen use the same code path server-side and cannot
  // drift apart.
  getResults: (id, categoryId = null) => {
    const params = categoryId ? `?categoryId=${categoryId}` : '';
    return request('GET', `/competitions/${id}/results${params}`);
  },
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
  // Stage lifecycle. A round cannot start on its own: GameOrchestrator.startRound
  // reads the stage context and refuses without it, so the judge must open a
  // stage first. `startStage` opens a named one; `startNextStage` advances after
  // the current one has finished, and refuses if no stage context is loaded.
  startStage: (competitionId, stageId) => request('POST', `/competitions/${competitionId}/stages/${stageId}/start`),
  startNextStage: (competitionId) => request('POST', `/competitions/${competitionId}/stages/next`),
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
  // createUser is the same endpoint the plan lists as "judge creation with
  // generated credentials". The server auto-scopes to the caller's org for
  // ORG_ADMIN, so the client does NOT send organizationId. Role can be
  // JUDGE / PLAYER / ORG_ADMIN — the judge page passes 'JUDGE'.
  createUser: ({ username, password, role }) =>
    request('POST', '/users', { username, password, role }),
  updateUserStatus: (id, status) => request('PUT', `/users/${id}/status`, { status }),

  // Participants (import)
  uploadParticipants: (competitionId, file) => uploadFile(`/competitions/${competitionId}/participants/upload`, file),
  confirmParticipants: (competitionId, rows) => request('POST', `/competitions/${competitionId}/participants/confirm`, { rows }),
  listParticipants: (competitionId) => request('GET', `/competitions/${competitionId}/participants`),
  deleteParticipants: (competitionId) => request('DELETE', `/competitions/${competitionId}/participants`),

  // Global participants list — across every competition of the caller's
  // organization. Read-only. Filters are optional; omit for "all". The
  // server enforces the tenant filter (organization_id) in the WHERE
  // clause — the client cannot bypass it by omitting a param.
  listAllParticipants: (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.competitionId) params.set('competitionId', filters.competitionId);
    if (filters.categoryId) params.set('categoryId', filters.categoryId);
    if (filters.search) params.set('search', filters.search);
    const qs = params.toString();
    return request('GET', `/participants${qs ? '?' + qs : ''}`);
  },

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

  // Super Admin — platform-wide overview (orgs, competitions, users).
  // Read-only; the server enforces SUPER_ADMIN role.
  getAdminOverview: () => request('GET', '/admin/overview'),

  // Display token management (ORG_ADMIN)
  generateDisplayToken: (competitionId) => request('POST', `/competitions/${competitionId}/display-token`),
  revokeDisplayToken: (competitionId) => request('DELETE', `/competitions/${competitionId}/display-token`),

  // Display mode & broadcast (ORG_ADMIN). The monitoring panel exposes these
  // so an ORG_ADMIN who is also judging can project a player from the console.
  // A plain JUDGE gets a 403 from the server — the panel reflects that by
  // hiding the button unless the user is an admin. See JudgeMonitoringPanel.
  setDisplayMode: (competitionId, mode) => request('PUT', `/competitions/${competitionId}/display/mode`, { mode }),
  broadcastPlayer: (competitionId, playerId) => request('PUT', `/competitions/${competitionId}/display/broadcast/${playerId}`),
  stopBroadcast: (competitionId) => request('DELETE', `/competitions/${competitionId}/display/broadcast`),

  // Participant monitoring — judge-only routes. GET /monitoring/participants
  // returns the live presence list; GET /monitoring/player/:id returns one
  // player's current grid/progress. Both require the caller to be an assigned
  // judge for this competition, checked server-side.
  getMonitoringParticipants: (competitionId) => request('GET', `/competitions/${competitionId}/monitoring/participants`),
  getMonitoringPlayer: (competitionId, playerId) => request('GET', `/competitions/${competitionId}/monitoring/player/${playerId}`),

  // Competition access links (ORG_ADMIN)
  generateAccessLink: (competitionId) => request('POST', `/competitions/${competitionId}/access-link`),
  getAccessLink: (competitionId) => request('GET', `/competitions/${competitionId}/access-link`),
  revokeAccessLink: (competitionId) => request('DELETE', `/competitions/${competitionId}/access-link`),

  // Publication — the middle step between DRAFT and RUNNING. The panel reads
  // GET /publishability to know whether Publish is allowed; the button calls
  // POST /publish. "On ne dépublie pas. Mais on peut annuler." — the
  // destructive step back is POST /cancel: it destroys the access link and
  // reverts to DRAFT. The server re-checks publishability on POST /publish
  // — the client does not decide.
  getPublishability: (competitionId) => request('GET', `/competitions/${competitionId}/publishability`),
  publishCompetition: (competitionId) => request('POST', `/competitions/${competitionId}/publish`),
  cancelCompetition: (competitionId) => request('POST', `/competitions/${competitionId}/cancel`),

  // Generic request (for endpoints not covered above)
  request,
};
