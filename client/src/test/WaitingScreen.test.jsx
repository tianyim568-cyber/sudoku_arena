// Unit tests for WaitingScreen — the player's waiting screen.
//
// WaitingScreen renders when no round is active (currentRound === null). It
// shows the competition name, a waiting message, and the full programme
// (every stage, its type, its round count).
//
// The contract pinned down here:
//   1. Stages appear in order, with their type and round count.
//   2. A failed listStages call shows the REASON — not a silent empty list.
//   3. A competition that truly has no stages shows a DISTINCT message.
// These last two must never be conflated: an empty list and a broken call
// mean opposite things, and a player who sees "no stages" when the call
// actually 500'd is being misled about the state of the competition.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import WaitingScreen from '../pages/WaitingScreen';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getCompetition: vi.fn(),
    listStages: vi.fn(),
  },
}));

const COMPETITION = {
  id: 'comp-1',
  name: 'Spring Cup',
  description: 'The spring championship',
};

const STAGES = [
  { id: 'stage-1', type: 'INDIVIDUAL', order_number: 1, rounds: [{ id: 'r1' }, { id: 'r2' }] },
  { id: 'stage-2', type: 'TEAM', order_number: 2, rounds: [{ id: 'r3' }, { id: 'r4' }, { id: 'r5' }] },
];

function renderScreen({
  competition = COMPETITION,
  stagesResponse = { code: 200, data: STAGES },
} = {}) {
  api.getCompetition.mockResolvedValue({ code: 200, data: competition });
  api.listStages.mockResolvedValue(stagesResponse);
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <WaitingScreen competitionId="comp-1" />
      </LanguageProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WaitingScreen', () => {
  it('shows the competition name and waiting message', async () => {
    renderScreen();
    expect(await screen.findByText('Spring Cup')).toBeInTheDocument();
    // The waiting message comes from the existing i18n key game.waitingRound.
    expect(screen.getByText(/waiting for the round to start|等待轮次开始/i)).toBeInTheDocument();
  });

  it('shows the description when present', async () => {
    renderScreen();
    expect(await screen.findByText('The spring championship')).toBeInTheDocument();
  });

  it('lists every stage in order with its type and round count', async () => {
    renderScreen();
    // The two stage types reuse existing competitionDetail.* keys.
    expect(await screen.findByText(/individual stage|个人赛阶段/i)).toBeInTheDocument();
    expect(screen.getByText(/team stage|团队赛阶段/i)).toBeInTheDocument();
    // stageRoundCount = '{count} round(s)' in en / '{count} 个轮次' in zh.
    expect(screen.getByText(/2 rounds?|2 个轮次/i)).toBeInTheDocument();
    expect(screen.getByText(/3 rounds?|3 个轮次/i)).toBeInTheDocument();
  });

  // The contract that matters: a failed call must show the reason, not a
  // silent empty list. "No stages" would mislead the player into thinking
  // the competition is unconfigured when the call actually failed.
  it('reports the reason when listStages fails — not an empty programme', async () => {
    renderScreen({
      stagesResponse: { code: 500, message: 'HTTP 500', data: null },
    });

    expect(await screen.findByText(/could not load the programme|无法加载赛程/i)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 500/)).toBeInTheDocument();
    // Must NOT show the "no stages" message — that would conflate error with empty.
    expect(screen.queryByText(/no stage configured|尚未配置任何阶段/i)).toBeNull();
  });

  // And the reverse: a competition that truly has no stages must say so
  // distinctly — not look like a loading state or an error.
  it('says so when the competition genuinely has no stages', async () => {
    renderScreen({
      stagesResponse: { code: 200, data: [] },
    });

    expect(await screen.findByText(/no stage configured|尚未配置任何阶段/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not load the programme|无法加载赛程/i)).toBeNull();
  });

  it('falls back to a default name when getCompetition fails', async () => {
    renderScreen({
      competition: null,
      // getCompetition returns a non-200 envelope — WaitingScreen ignores it
      // and uses the default name. The programme can still render.
      stagesResponse: { code: 200, data: STAGES },
    });
    api.getCompetition.mockResolvedValue({ code: 500, message: 'HTTP 500', data: null });

    // defaultCompetitionName = 'Match' in en, '比赛' in zh.
    expect(await screen.findByText(/match|比赛/i)).toBeInTheDocument();
    // Programme is still shown — a missing name is not a reason to hide it.
    expect(screen.getByText(/individual stage|个人赛阶段/i)).toBeInTheDocument();
  });
});
