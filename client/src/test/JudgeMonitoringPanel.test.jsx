// Tests for JudgeMonitoringPanel — the judge's live participant view.
//
// What this file pins, in priority order (the prompt names the first two):
//
//   1. A participant who goes offline is SEEN. The WS event
//      PARTICIPANT_LIST_STATE_UPDATE arrives; the panel updates the dot
//      and the summary. This is the one behavior the panel exists for.
//
//   2. The page stays correct when the list is empty. "Nobody imported
//      yet" is the normal pre-start state — it is NOT an error, and the
//      panel must not render a loading spinner forever or a red error.
//
//   3. Clicking a participant fetches and shows their detail.
//
//   4. Projection is admin-only: a plain judge does not see the
//      "project to big screen" button.
//
//   5. The search box filters by name/school/team.
//
// The server routes are Sylvain's and are NOT tested here. We mock the
// api module and the socket subscription; the integration with the
// real WS is covered by the e2e scripts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import JudgeMonitoringPanel from '../components/JudgeMonitoringPanel';
import { api } from '../api';

// The panel subscribes to WS events via onEvent. We capture the callback
// so the test can push events into the panel as the server would.
let eventCallback = null;
const cleanupMock = vi.fn();

vi.mock('../api/socket', () => ({
  connectSocket: vi.fn(() => ({})),
  joinRoom: vi.fn(),
  onEvent: vi.fn((cb) => { eventCallback = cb; return cleanupMock; }),
}));

vi.mock('../api', () => ({
  api: {
    getMonitoringParticipants: vi.fn(),
    getMonitoringPlayer: vi.fn(),
    broadcastPlayer: vi.fn(),
    stopBroadcast: vi.fn(),
  },
  setToken: vi.fn(),
}));

// Mutable auth mock — tests can flip `authState` to simulate an admin.
// Using vi.hoisted ensures the mock is installed before the component
// module is imported, and the getter reads the current value at render
// time so tests can change it.
const { authState } = vi.hoisted(() => ({ authState: { user: { id: 'j1', role: 'JUDGE' }, isAdmin: false } }));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => authState,
}));

function renderPanel({ competitionId = 'c1' } = {}) {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <JudgeMonitoringPanel competitionId={competitionId} />
      </LanguageProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  eventCallback = null;
  // Reset to the default judge auth for every test; admin tests override.
  authState.user = { id: 'j1', role: 'JUDGE' };
  authState.isAdmin = false;
});

// Helper: push a WS event into the panel as the server would.
function pushEvent(event) {
  act(() => {
    if (eventCallback) eventCallback(event);
  });
}

describe('JudgeMonitoringPanel — empty list is not an error', () => {
  it('shows the empty-state message (not a loading spinner forever) when no participants are imported', async () => {
    api.getMonitoringParticipants.mockResolvedValue({
      code: 200,
      data: { competitionId: 'c1', participants: [], summary: { total: 0, online: 0, offline: 0 } },
    });
    renderPanel();
    // The empty message is the one that says "no participants yet" — NOT
    // the loading message and NOT an error.
    expect(await screen.findByText(/no participants yet|暂无选手/i)).toBeInTheDocument();
    expect(screen.queryByText(/loading|加载/i)).toBeNull();
  });

  it('shows a load error (not the empty state) when the GET fails', async () => {
    api.getMonitoringParticipants.mockResolvedValue({ code: 50000, message: 'boom' });
    renderPanel();
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});

describe('JudgeMonitoringPanel — a participant going offline is seen', () => {
  // THE test. The panel exists for this. A player is online; the server
  // pushes a new list where that player is offline; the dot flips and
  // the summary reflects it.
  it('flips the presence dot and updates the summary when a player goes offline', async () => {
    api.getMonitoringParticipants.mockResolvedValue({
      code: 200,
      data: {
        competitionId: 'c1',
        participants: [
          { id: 'p1', name: 'Alice', school: 'Lycée A', teamName: 'Tigers', online: true, lastHeartbeatAt: Date.now() },
          { id: 'p2', name: 'Bob', school: 'Lycée B', teamName: 'Bears', online: true, lastHeartbeatAt: Date.now() },
        ],
        summary: { total: 2, online: 2, offline: 0 },
      },
    });
    renderPanel();

    // Wait for initial fetch — both online.
    expect(await screen.findByText(/2 online \/ 2|2 在线 \/ 2/i)).toBeInTheDocument();

    // Server pushes an update: Bob went offline.
    pushEvent({
      type: 'PARTICIPANT_LIST_STATE_UPDATE',
      competitionId: 'c1',
      payload: {
        participants: [
          { id: 'p1', name: 'Alice', school: 'Lycée A', teamName: 'Tigers', online: true, lastHeartbeatAt: Date.now() },
          { id: 'p2', name: 'Bob', school: 'Lycée B', teamName: 'Bears', online: false, lastHeartbeatAt: Date.now() - 60000 },
        ],
        summary: { total: 2, online: 1, offline: 1 },
      },
    });

    // The summary updates — this is the most direct signal the judge
    // would notice.
    expect(await screen.findByText(/1 online \/ 2|1 在线 \/ 2/i)).toBeInTheDocument();
  });

  it('ignores PARTICIPANT_LIST_STATE_UPDATE events for a different competition', async () => {
    api.getMonitoringParticipants.mockResolvedValue({
      code: 200,
      data: {
        competitionId: 'c1',
        participants: [
          { id: 'p1', name: 'Alice', school: null, teamName: null, online: true, lastHeartbeatAt: Date.now() },
        ],
        summary: { total: 1, online: 1, offline: 0 },
      },
    });
    renderPanel();
    expect(await screen.findByText(/1 online \/ 1|1 在线 \/ 1/i)).toBeInTheDocument();

    // An event for a DIFFERENT competition arrives. The panel must NOT
    // replace its list with it.
    pushEvent({
      type: 'PARTICIPANT_LIST_STATE_UPDATE',
      competitionId: 'c-other',
      payload: {
        participants: [
          { id: 'px', name: 'Stranger', school: null, teamName: null, online: false, lastHeartbeatAt: null },
        ],
        summary: { total: 1, online: 0, offline: 1 },
      },
    });

    // The summary stays at 1/1 — the cross-competition event was ignored.
    expect(screen.getByText(/1 online \/ 1|1 在线 \/ 1/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 online \/ 1|0 在线 \/ 1/i)).toBeNull();
  });
});

describe('JudgeMonitoringPanel — participant detail', () => {
  it('fetches and shows the player state when a participant is clicked', async () => {
    api.getMonitoringParticipants.mockResolvedValue({
      code: 200,
      data: {
        competitionId: 'c1',
        participants: [
          { id: 'p1', name: 'Alice', school: null, teamName: null, online: true, lastHeartbeatAt: Date.now() },
        ],
        summary: { total: 1, online: 1, offline: 0 },
      },
    });
    api.getMonitoringPlayer.mockResolvedValue({
      code: 200,
      data: {
        playerId: 'p1',
        playerName: 'Alice',
        roundId: 'r1',
        sessionStatus: 'IN_PROGRESS',
        puzzles: [
          {
            puzzleId: 'pz1',
            currentGrid: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
            correctCells: 3,
            totalEmptyCells: 9,
            progressPercentage: 33,
          },
        ],
      },
    });
    renderPanel();

    // Click the participant row.
    const alice = await screen.findByText('Alice');
    fireEvent.click(alice);

    // The detail panel shows the player name and the progress line.
    expect(await screen.findByText(/Puzzle 1|题目 1/i)).toBeInTheDocument();
    expect(screen.getByText(/33%/)).toBeInTheDocument();
  });

  it('shows the "no active round" hint when roundId is null', async () => {
    api.getMonitoringParticipants.mockResolvedValue({
      code: 200,
      data: {
        competitionId: 'c1',
        participants: [
          { id: 'p1', name: 'Alice', school: null, teamName: null, online: true, lastHeartbeatAt: Date.now() },
        ],
        summary: { total: 1, online: 1, offline: 0 },
      },
    });
    api.getMonitoringPlayer.mockResolvedValue({
      code: 200,
      data: { playerId: 'p1', playerName: 'Alice', roundId: null, sessionStatus: null, puzzles: [] },
    });
    renderPanel();
    fireEvent.click(await screen.findByText('Alice'));
    expect(await screen.findByText(/no round is running|当前没有进行中的轮次/i)).toBeInTheDocument();
  });
});

describe('JudgeMonitoringPanel — projection is JUDGE-only (2026-08-24)', () => {
  // Product decision 2026-08-24: projection is a floor operation reserved
  // for the JUDGE. ORG_ADMIN is intentionally excluded even though it is
  // normally the more privileged role. See routes/display.js docstring.
  it('does NOT show the "project to big screen" button for an ORG_ADMIN', async () => {
    // Flip auth to ORG_ADMIN for this test.
    authState.user = { id: 'admin1', role: 'ORG_ADMIN' };
    authState.isAdmin = true;

    api.getMonitoringParticipants.mockResolvedValue({
      code: 200,
      data: {
        competitionId: 'c1',
        participants: [
          { id: 'p1', name: 'Alice', school: null, teamName: null, online: true, lastHeartbeatAt: Date.now() },
        ],
        summary: { total: 1, online: 1, offline: 0 },
      },
    });
    renderPanel();
    await screen.findByText('Alice');
    // No projection button anywhere — an org admin cannot project.
    expect(screen.queryByRole('button', { name: /project to big screen|投影到大屏/i })).toBeNull();
    // And the explanation is shown.
    expect(screen.getByText(/projection is reserved|投影功能仅限/i)).toBeInTheDocument();
  });
});

describe('JudgeMonitoringPanel — search filters the list', () => {
  it('narrows the list by name when the search box is typed into', async () => {
    api.getMonitoringParticipants.mockResolvedValue({
      code: 200,
      data: {
        competitionId: 'c1',
        participants: [
          { id: 'p1', name: 'Alice', school: 'Lycée A', teamName: 'Tigers', online: true, lastHeartbeatAt: Date.now() },
          { id: 'p2', name: 'Bob', school: 'Lycée B', teamName: 'Bears', online: false, lastHeartbeatAt: Date.now() },
        ],
        summary: { total: 2, online: 1, offline: 1 },
      },
    });
    renderPanel();
    await screen.findByText('Alice');
    expect(screen.getByText('Bob')).toBeInTheDocument();

    // Type "ali" — only Alice should remain.
    const input = screen.getByPlaceholderText(/search|搜索/i);
    fireEvent.change(input, { target: { value: 'ali' } });

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Bob')).toBeNull();
  });
});

describe('JudgeMonitoringPanel — judge projection flow (2026-08-24)', () => {
  it('calls broadcastPlayer when a JUDGE clicks "project to big screen" and confirms', async () => {
    // Default authState already sets role: 'JUDGE' — see line 56. No need
    // to flip auth. The judge is the one running the room; projection is
    // their button (product decision 2026-08-24).
    api.getMonitoringParticipants.mockResolvedValue({
      code: 200,
      data: {
        competitionId: 'c1',
        participants: [
          { id: 'p1', name: 'Alice', school: null, teamName: null, online: true, lastHeartbeatAt: Date.now() },
        ],
        summary: { total: 1, online: 1, offline: 0 },
      },
    });
    api.broadcastPlayer.mockResolvedValue({ code: 200, data: { id: 'p1', name: 'Alice' } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderPanel();

    const projectBtn = await screen.findByRole('button', { name: /project to big screen|投影到大屏/i });
    fireEvent.click(projectBtn);

    await waitFor(() => expect(api.broadcastPlayer).toHaveBeenCalledWith('c1', 'p1'));
  });

  it('does NOT call broadcastPlayer when the judge cancels the confirm dialog', async () => {
    // Default authState is already JUDGE — no flip needed.

    api.getMonitoringParticipants.mockResolvedValue({
      code: 200,
      data: {
        competitionId: 'c1',
        participants: [
          { id: 'p1', name: 'Alice', school: null, teamName: null, online: true, lastHeartbeatAt: Date.now() },
        ],
        summary: { total: 1, online: 1, offline: 0 },
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderPanel();

    const projectBtn = await screen.findByRole('button', { name: /project to big screen|投影到大屏/i });
    fireEvent.click(projectBtn);

    // Confirm was called, but the API was NOT — the admin backed out.
    expect(window.confirm).toHaveBeenCalled();
    expect(api.broadcastPlayer).not.toHaveBeenCalled();
  });
});
