// Unit tests for PreparationScreen — the preparation phase screen.
//
// PreparationScreen renders between "judge starts round" and "round goes live".
// It shows the round name, its type, the rules for that type, and a countdown
// to the start.
//
// The contract pinned down here:
//   1. The round name and type are shown.
//   2. The rules shown depend on the round type — three known types, each with
//      its own text. An unknown type falls back to a generic message, NOT a
//      crash.
//   3. The countdown value comes from useTimer — the same hook the match timer
//      uses. PreparationScreen never re-implements a countdown.
//   4. The screen returns null when preparation is null (defensive — the
//      parent already guards on this, but the component must not crash if
//      called with nothing).
//
// useTimer is mocked because it drives requestAnimationFrame, which jsdom does
// not provide. The real hook is exercised by the match timer tests; here we
// only care that PreparationScreen CONSUMES its output correctly.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import PreparationScreen from '../pages/PreparationScreen';

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

const PREPARATION = {
  roundId: 'r-1',
  roundNumber: 1,
  roundName: 'Quarterfinal',
  roundType: 'ROUND1_NINE_ONE',
  preparationSeconds: 10,
  durationSeconds: 10,
  turnEndsAt: Date.now() + 10000,
};

function renderScreen({ preparation = PREPARATION } = {}) {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <PreparationScreen preparation={preparation} />
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

describe('PreparationScreen', () => {
  it('shows the round name and type label', () => {
    renderScreen();
    expect(screen.getByText('Quarterfinal')).toBeInTheDocument();
    // common.roundName.ROUND1_NINE_ONE in en = "Round 1: Nine-One"
    expect(screen.getByText(/round 1: nine-one|第一轮：九宫一填/i)).toBeInTheDocument();
  });

  it('shows the rules for Round 1 (Nine-One)', () => {
    renderScreen();
    // rulesRound1 mentions the single empty cell and the 9 puzzles.
    expect(screen.getByText(/single empty cell|只有一个空格/i)).toBeInTheDocument();
  });

  it('shows the rules for Round 2 (Relay)', () => {
    renderScreen({
      preparation: { ...PREPARATION, roundType: 'ROUND2_RELAY' },
    });
    // rulesRound2 mentions each player getting their own puzzle. We match on
    // that phrase specifically because the word "rotate"/"轮转" also appears
    // in the round-type label, which would match twice.
    expect(screen.getByText(/own puzzle|各分到一道题/i)).toBeInTheDocument();
  });

  it('shows the rules for Round 3 (Collaborate)', () => {
    renderScreen({
      preparation: { ...PREPARATION, roundType: 'ROUND3_COLLABORATE' },
    });
    // rulesRound3 mentions proposing a value and teammate acceptance. The word
    // "collaborate" also appears in the type label, so we match on "propose".
    expect(screen.getByText(/propose a value|提出填数建议/i)).toBeInTheDocument();
  });

  // The guard that matters: an unknown round type must not crash the screen.
  // The server could introduce a new type before the client learns about it;
  // the player should still see the countdown, with a generic rules message.
  it('falls back to a generic message for an unknown round type', () => {
    renderScreen({
      preparation: { ...PREPARATION, roundType: 'ROUND4_SOMETHING_NEW' },
    });
    // Still shows the round name and countdown — did not crash.
    expect(screen.getByText('Quarterfinal')).toBeInTheDocument();
    expect(screen.getByText(/unknown round type|未知轮次类型|rules are not available|暂未说明/i)).toBeInTheDocument();
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

  it('passes the preparation turnEndsAt and durationSeconds to useTimer', () => {
    const turnEndsAt = Date.now() + 7000;
    renderScreen({
      preparation: { ...PREPARATION, turnEndsAt, durationSeconds: 7 },
    });
    expect(useTimer).toHaveBeenCalledWith({
      turnEndsAt,
      timerStatus: 'RUNNING',
      durationSeconds: 7,
    });
  });

  it('returns null when preparation is null', () => {
    const { container } = renderScreen({ preparation: null });
    expect(container.firstChild).toBeNull();
  });
});
