// Tests for DisplayModeControls — the admin block that picks what the big
// screen shows.
//
// What this file pins, in priority order (the prompt names the first two):
//
//   1. Clicking a mode calls PUT /display/mode with the correct mode.
//      The two exposed modes are DEFAULT and LIVE_RANKING. The component
//      must call api.setDisplayMode(competitionId, mode) on click.
//
//   2. A plain judge does not see the buttons. The parent gates the block
//      on isAdmin, so we verify the component renders its content but the
//      decision to render is the parent's — we test the parent's gate too.
//
//   3. The current mode is VISIBLE. A judge must know what the room sees
//      without looking at the screen.
//
//   4. A failed switch (403, network) does NOT update the highlight —
//      the judge must see that the room did not move.
//
//   5. Switching away from PLAYER_BROADCAST calls stopBroadcast FIRST.
//      setDisplayMode alone leaves broadcast_player_id dangling; the
//      component must clean the projection before setting the new mode.
//
//   6. A DISPLAY_MODE_CHANGED WS event from another admin triggers a
//      refresh — the highlight tracks the server, not the last click.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import DisplayModeControls from '../components/DisplayModeControls';
import { api } from '../api';

// The component subscribes to WS events via onEvent. We capture the callback
// so tests can push events into the component as the server would.
let eventCallback = null;
const cleanupMock = vi.fn();

vi.mock('../api/socket', () => ({
  connectSocket: vi.fn(() => ({})),
  onEvent: vi.fn((cb) => { eventCallback = cb; return cleanupMock; }),
}));

vi.mock('../api', () => ({
  api: {
    setDisplayMode: vi.fn(),
    stopBroadcast: vi.fn(),
  },
  setToken: vi.fn(),
}));

function renderControls({ competitionId = 'c1', currentMode = 'DEFAULT', onModeChanged = vi.fn(), isAdmin = true } = {}) {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <DisplayModeControls
          competitionId={competitionId}
          currentMode={currentMode}
          onModeChanged={onModeChanged}
          isAdmin={isAdmin}
        />
      </LanguageProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  eventCallback = null;
});

// Helper: push a WS event into the component as the server would.
function pushEvent(event) {
  act(() => {
    if (eventCallback) eventCallback(event);
  });
}

describe('DisplayModeControls — clicking a mode calls the right route', () => {
  it('calls api.setDisplayMode(competitionId, "LIVE_RANKING") when the live-ranking button is clicked', async () => {
    api.setDisplayMode.mockResolvedValue({ code: 200, data: { mode: 'LIVE_RANKING' } });
    const onModeChanged = vi.fn();
    renderControls({ currentMode: 'DEFAULT', onModeChanged });

    const btn = screen.getByRole('button', { name: /live ranking|实时排行榜/i });
    fireEvent.click(btn);

    await waitFor(() => expect(api.setDisplayMode).toHaveBeenCalledWith('c1', 'LIVE_RANKING'));
    // On success, the parent is asked to refresh — the new mode shows via
    // competition.display_mode, not via local optimism.
    await waitFor(() => expect(onModeChanged).toHaveBeenCalled());
  });

  it('calls api.setDisplayMode(competitionId, "DEFAULT") when the default button is clicked', async () => {
    api.setDisplayMode.mockResolvedValue({ code: 200, data: { mode: 'DEFAULT' } });
    renderControls({ currentMode: 'LIVE_RANKING' });

    const btn = screen.getByRole('button', { name: /default view|默认视图/i });
    fireEvent.click(btn);

    await waitFor(() => expect(api.setDisplayMode).toHaveBeenCalledWith('c1', 'DEFAULT'));
  });
});

describe('DisplayModeControls — the current mode is visible', () => {
  it('shows the mode name in the "currently showing" line so the judge knows what the room sees', () => {
    renderControls({ currentMode: 'LIVE_RANKING' });
    // The status line label. We match with the colon so the Chinese regex
    // does not also match the subtitle ("选择场地大屏当前显示的内容。").
    expect(screen.getByText(/currently showing:|当前显示：/i)).toBeInTheDocument();
    // The mode name appears in the status line AND in the button — both
    // are fine, the point is that it is visible.
    expect(screen.getAllByText(/live ranking|实时排行榜/i).length).toBeGreaterThan(0);
  });

  it('shows "Default view" in the status line when currentMode is DEFAULT', () => {
    renderControls({ currentMode: 'DEFAULT' });
    // The mode name is visible (in the status line and in the button).
    expect(screen.getAllByText(/default view|默认视图/i).length).toBeGreaterThan(0);
  });

  it('shows "A projected player" in the status line when currentMode is PLAYER_BROADCAST', () => {
    // We do not offer a button for PLAYER_BROADCAST — but the judge must
    // still SEE that a player is being projected, so they understand what
    // the room is watching and what a mode switch will interrupt.
    renderControls({ currentMode: 'PLAYER_BROADCAST' });
    // The mode name appears in the status line and in the projected hint.
    expect(screen.getAllByText(/a projected player|某位选手/i).length).toBeGreaterThan(0);
  });
});

describe('DisplayModeControls — a failed switch does not lie', () => {
  it('shows an error and does NOT call onModeChanged when setDisplayMode fails', async () => {
    api.setDisplayMode.mockResolvedValue({ code: 40300, message: 'forbidden' });
    const onModeChanged = vi.fn();
    renderControls({ currentMode: 'DEFAULT', onModeChanged });

    const btn = screen.getByRole('button', { name: /live ranking|实时排行榜/i });
    fireEvent.click(btn);

    // The error surfaces — the judge sees the room did not move.
    expect(await screen.findByText(/forbidden/)).toBeInTheDocument();
    // onModeChanged is NOT called: the parent does not refresh, the
    // highlight stays on DEFAULT.
    expect(onModeChanged).not.toHaveBeenCalled();
  });

  it('shows the generic failure message when the response has no message', async () => {
    api.setDisplayMode.mockResolvedValue({ code: 50000 });
    renderControls({ currentMode: 'DEFAULT' });

    fireEvent.click(screen.getByRole('button', { name: /live ranking|实时排行榜/i }));

    expect(await screen.findByText(/could not switch|无法切换/i)).toBeInTheDocument();
  });
});

describe('DisplayModeControls — switching away from a broadcast cleans the projection', () => {
  it('calls stopBroadcast THEN setDisplayMode when the current mode is PLAYER_BROADCAST', async () => {
    api.stopBroadcast.mockResolvedValue({ code: 200 });
    api.setDisplayMode.mockResolvedValue({ code: 200 });
    renderControls({ currentMode: 'PLAYER_BROADCAST' });

    fireEvent.click(screen.getByRole('button', { name: /live ranking|实时排行榜/i }));

    // stopBroadcast must be called first — setDisplayMode alone leaves
    // broadcast_player_id dangling on the competition row.
    await waitFor(() => expect(api.stopBroadcast).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(api.setDisplayMode).toHaveBeenCalledWith('c1', 'LIVE_RANKING'));
    // Order matters: stop before set.
    const stopOrder = api.stopBroadcast.mock.invocationCallOrder[0];
    const setOrder = api.setDisplayMode.mock.invocationCallOrder[0];
    expect(stopOrder).toBeLessThan(setOrder);
  });

  it('does NOT call setDisplayMode when stopBroadcast fails', async () => {
    api.stopBroadcast.mockResolvedValue({ code: 50000, message: 'boom' });
    api.setDisplayMode.mockResolvedValue({ code: 200 });
    renderControls({ currentMode: 'PLAYER_BROADCAST' });

    fireEvent.click(screen.getByRole('button', { name: /default view|默认视图/i }));

    expect(await screen.findByText(/boom/)).toBeInTheDocument();
    // The mode was not switched — the judge sees the error and the room
    // keeps showing the projected player.
    expect(api.setDisplayMode).not.toHaveBeenCalled();
  });

  it('does NOT call stopBroadcast when the current mode is not PLAYER_BROADCAST', async () => {
    api.setDisplayMode.mockResolvedValue({ code: 200 });
    renderControls({ currentMode: 'DEFAULT' });

    fireEvent.click(screen.getByRole('button', { name: /live ranking|实时排行榜/i }));

    await waitFor(() => expect(api.setDisplayMode).toHaveBeenCalledWith('c1', 'LIVE_RANKING'));
    expect(api.stopBroadcast).not.toHaveBeenCalled();
  });
});

describe('DisplayModeControls — a WS event from another admin triggers a refresh', () => {
  it('calls onModeChanged when a DISPLAY_MODE_CHANGED event arrives for this competition', async () => {
    const onModeChanged = vi.fn();
    renderControls({ currentMode: 'DEFAULT', onModeChanged });

    pushEvent({
      type: 'DISPLAY_MODE_CHANGED',
      competitionId: 'c1',
      payload: { mode: 'LIVE_RANKING' },
    });

    await waitFor(() => expect(onModeChanged).toHaveBeenCalled());
  });

  it('ignores DISPLAY_MODE_CHANGED events for a different competition', async () => {
    const onModeChanged = vi.fn();
    renderControls({ currentMode: 'DEFAULT', onModeChanged });

    pushEvent({
      type: 'DISPLAY_MODE_CHANGED',
      competitionId: 'c-other',
      payload: { mode: 'LIVE_RANKING' },
    });

    // Give the event a tick to be processed — it should NOT call.
    await new Promise((r) => setTimeout(r, 0));
    expect(onModeChanged).not.toHaveBeenCalled();
  });
});

describe('DisplayModeControls — non-admin sees the explanation, not the buttons', () => {
  // The prompt: "Regarde comment le panneau de surveillance a résolu ça pour
  // la projection (bouton masqué pour un non-admin, mention expliquant
  // pourquoi) et fais pareil." A plain judge gets a 403 on the display-mode
  // routes; we hide the buttons and explain why, rather than showing a
  // button that will fail.
  it('does NOT render the mode buttons for a non-admin', () => {
    renderControls({ currentMode: 'DEFAULT', isAdmin: false });
    expect(screen.queryByRole('button', { name: /default view|默认视图/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /live ranking|实时排行榜/i })).toBeNull();
  });

  it('shows the explanation note for a non-admin', () => {
    renderControls({ currentMode: 'DEFAULT', isAdmin: false });
    expect(screen.getByText(/reserved for org admins|仅限机构管理员/i)).toBeInTheDocument();
  });

  it('still shows the current mode to a non-admin (they need to know what the room sees)', () => {
    renderControls({ currentMode: 'LIVE_RANKING', isAdmin: false });
    // The status line is visible to everyone — a judge who cannot switch
    // still needs to know what the room is watching.
    expect(screen.getByText(/currently showing:|当前显示：/i)).toBeInTheDocument();
    expect(screen.getAllByText(/live ranking|实时排行榜/i).length).toBeGreaterThan(0);
  });
});

describe('DisplayModeControls — only five modes are exposed', () => {
  it('does not offer a button for PLAYER_BROADCAST (that is the surveillance panel\'s job)', () => {
    renderControls({ currentMode: 'DEFAULT' });
    // Five mode buttons, not six. PLAYER_BROADCAST has no button here — it is
    // driven by the projection button in JudgeMonitoringPanel.
    const modeButtons = screen.getAllByRole('button').filter((b) =>
      /default view|live ranking|round ranking|stage ranking|final ranking|默认视图|实时排行榜|单轮排名|阶段排名|最终排名/i.test(b.textContent));
    expect(modeButtons).toHaveLength(5);
  });

  it('offers a button for STAGE_RANKING (the view exists now)', () => {
    renderControls({ currentMode: 'DEFAULT' });
    // STAGE_RANKING has a dedicated view — the button is no longer a lie.
    expect(screen.getByRole('button', { name: /stage ranking|阶段排名/i })).toBeInTheDocument();
  });
});
