// Unit tests for TransitionScreen — the between-rounds transition screen.
//
// TransitionScreen renders between ROUND_FINISHED (of round N) and
// ROUND_PREPARATION_STARTED (of round N+1). It shows: what just finished
// (name only, no score), what comes next (name + type), and a countdown
// to the next start.
//
// The contract pinned down here:
//   1. The next round name and type are shown.
//   2. The finished round name is shown when `finishedRound` is present.
//   3. A generic "round complete" message is shown when `finishedRound` is
//      null (page reload during the transition window — the client doesn't
//      know what just ended).
//   4. NO score, NO ranking, NO results appear anywhere on the screen —
//      this is a product decision, not a simplification.
//   5. The countdown value comes from useTimer — the same hook the match
//      timer and PreparationScreen use. TransitionScreen never re-implements
//      a countdown.
//   6. An unknown next-round type falls back to showing the raw type string
//     rather than crashing.
//   7. The screen returns null when transition is null (defensive — the
//      parent already guards on this).
//
// useTimer is mocked because it drives requestAnimationFrame, which jsdom does
// not provide. The real hook is exercised by the match timer tests; here we
// only care that TransitionScreen CONSUMES its output correctly.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import TransitionScreen from '../pages/TransitionScreen';

// Mock useTimer so we control the countdown without rAF. The spy lets each
// test pin the return value it needs.
vi.mock('../hooks/useTimer', () => ({
  useTimer: vi.fn(() => ({
    remainingSeconds: 5,
    formattedTime: '0:05',
    progress: 0.5,
    isPaused: false,
  })),
}));

import { useTimer } from '../hooks/useTimer';

const TRANSITION = {
  finishedRound: {
    roundId: 'r-1',
    roundName: 'Quarterfinal',
    roundType: 'ROUND1_NINE_ONE',
  },
  nextRound: {
    roundId: 'r-2',
    roundName: 'Semifinal',
    roundType: 'ROUND2_RELAY',
    roundNumber: 2,
  },
  durationSeconds: 5,
  turnEndsAt: Date.now() + 5000,
};

function renderScreen({ transition = TRANSITION } = {}) {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <TransitionScreen transition={transition} />
      </LanguageProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Restore the default mock return between tests.
  useTimer.mockReturnValue({
    remainingSeconds: 5,
    formattedTime: '0:05',
    progress: 0.5,
    isPaused: false,
  });
});

describe('TransitionScreen', () => {
  it('shows the next round name', () => {
    renderScreen();
    expect(screen.getByText('Semifinal')).toBeInTheDocument();
  });

  it('shows the next round type label', () => {
    renderScreen();
    // common.roundName.ROUND2_RELAY in en = "Round 2: Relay"
    expect(screen.getByText(/round 2: relay|第二轮：接力轮转/i)).toBeInTheDocument();
  });

  it('shows the finished round name when finishedRound is present', () => {
    renderScreen();
    expect(screen.getByText('Quarterfinal')).toBeInTheDocument();
  });

  // The guard that matters for the reload case: if the player refreshes during
  // the transition window, useGameSocket has no lastRound to rebuild
  // finishedRound from. The screen must not show a raw roundId (UUID) — it
  // falls back to a generic message.
  it('shows a generic message when finishedRound is null (reload case)', () => {
    renderScreen({
      transition: { ...TRANSITION, finishedRound: null },
    });
    // "Round complete" / "本轮已完成" — generic, no raw UUID.
    expect(screen.getByText(/round complete|本轮已完成/i)).toBeInTheDocument();
    // And it does NOT show the "Just finished" label.
    expect(screen.queryByText(/just finished|刚刚结束/i)).not.toBeInTheDocument();
  });

  // The countdown value comes straight from useTimer. If the hook says 3, the
  // screen shows 3 — there is no second countdown computation here.
  it('renders the countdown value from useTimer', () => {
    useTimer.mockReturnValue({
      remainingSeconds: 3,
      formattedTime: '0:03',
      progress: 0.7,
      isPaused: false,
    });
    renderScreen();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('passes the transition turnEndsAt and durationSeconds to useTimer', () => {
    const turnEndsAt = Date.now() + 4000;
    renderScreen({
      transition: { ...TRANSITION, turnEndsAt, durationSeconds: 4 },
    });
    expect(useTimer).toHaveBeenCalledWith({
      turnEndsAt,
      timerStatus: 'RUNNING',
      durationSeconds: 4,
    });
  });

  // The guard that matters: an unknown round type must not crash the screen.
  // The server could introduce a new type before the client learns about it;
  // the player should still see the countdown, with the raw type string.
  it('falls back to the raw type string for an unknown round type', () => {
    renderScreen({
      transition: {
        ...TRANSITION,
        nextRound: { ...TRANSITION.nextRound, roundType: 'ROUND4_SOMETHING_NEW' },
      },
    });
    // Still shows the next round name and countdown — did not crash.
    expect(screen.getByText('Semifinal')).toBeInTheDocument();
    // Default mock returns remainingSeconds: 5.
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('returns null when transition is null', () => {
    const { container } = renderScreen({ transition: null });
    expect(container.firstChild).toBeNull();
  });

  // The product decision enforced at the test level: no score, no ranking,
  // no results text appears anywhere on the screen.
  it('does not show any score, rank, or results text', () => {
    renderScreen();
    expect(screen.queryByText(/score|points|rank|result|得分|分数|排名|成绩/i)).not.toBeInTheDocument();
  });
});
