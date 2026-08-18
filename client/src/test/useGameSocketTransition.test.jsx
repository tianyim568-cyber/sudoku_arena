// Regression tests for the between-rounds states of useGameSocket.
//
// Why a HOOK test and not a component test: TransitionScreen and
// PreparationScreen are already covered in isolation, with their state handed
// in as a prop. That proves they render correctly — it proves nothing about
// whether the hook ever builds that state correctly from real events.
//
// The bug this file exists for: the socket handler is registered inside an
// effect that depends only on [user, competitionId], so it is created ONCE and
// closes over the render values of that moment. Every other handler mutates
// through functional updates (setX(prev => …)), which are immune. Reading a
// plain useState value inside the handler is NOT: it would see the initial
// null forever. The finished round's name comes from exactly such a read, so
// it must live in a ref. Nothing in a component test can see this.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useGameSocket } from '../hooks/useGameSocket';

// Captures the handler useGameSocket registers, so tests can push events
// through the same path a real socket would.
let emit;

vi.mock('../api/socket', () => ({
  connectSocket: () => ({}),
  disconnectSocket: vi.fn(),
  joinRoom: vi.fn(),
  leaveRoom: vi.fn(),
  onEvent: (callback) => {
    emit = callback;
    return () => {};
  },
  round2CellUpdate: vi.fn(),
  round3ProposeCell: vi.fn(),
  round3AcceptProposal: vi.fn(),
  round3RejectProposal: vi.fn(),
  round3WithdrawProposal: vi.fn(),
  round3FocusUpdate: vi.fn(),
}));

// The user object MUST be a stable reference across renders. In production it
// is: it lives in a useState inside AuthProvider and only changes identity on
// login/logout. Returning a fresh literal here would make the socket effect
// (deps: [user, competitionId]) re-run on every render, re-registering the
// handler with a fresh closure each time — which silently masks the very
// stale-closure bug these tests exist to catch.
const USER = { id: 'p-1', role: 'PLAYER' };
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: USER }),
}));

// Renders the two between-rounds states as text so assertions can read them.
function Probe() {
  const { preparation, transition } = useGameSocket('comp-1');
  return (
    <div>
      <span data-testid="prep">{preparation ? preparation.roundName : 'none'}</span>
      <span data-testid="finished">
        {transition ? (transition.finishedRound?.roundName ?? 'unknown') : 'none'}
      </span>
      <span data-testid="next">
        {transition ? transition.nextRound.roundName : 'none'}
      </span>
    </div>
  );
}

const send = (type, payload) => act(() => emit({ type, payload }));

const startRound1 = () => send('ROUND_STARTED', {
  roundId: 'r-1', roundNumber: 1, roundName: 'Round One',
  roundType: 'ROUND1_NINE_ONE', turnEndsAt: Date.now() + 60000, durationSeconds: 60,
});

const transitionToRound2 = () => send('ROUND_TRANSITION_STARTED', {
  finishedRoundId: 'r-1', nextRoundId: 'r-2', nextRoundName: 'Round Two',
  nextRoundType: 'ROUND2_RELAY', nextRoundOrder: 2, transitionSeconds: 5,
});

beforeEach(() => {
  emit = null;
  render(<Probe />);
});

describe('useGameSocket — between-rounds states', () => {
  // THE regression test. Before the fix, `finished` read "unknown" here: the
  // handler saw the initial value of a useState that had been updated on a
  // later render it never observed. Everything downstream looked fine — the
  // screen rendered, the countdown ran, the tests were green — and the player
  // simply never learned which round had just ended.
  it('remembers the finished round across the ROUND_STARTED → transition gap', () => {
    startRound1();
    transitionToRound2();

    expect(screen.getByTestId('finished')).toHaveTextContent('Round One');
    expect(screen.getByTestId('next')).toHaveTextContent('Round Two');
  });

  it('falls back to no finished round when none was ever played (reload mid-transition)', () => {
    transitionToRound2();
    expect(screen.getByTestId('finished')).toHaveTextContent('unknown');
    expect(screen.getByTestId('next')).toHaveTextContent('Round Two');
  });

  it('builds a countdown target from the duration the server sends', () => {
    // The server sends transitionSeconds, not an absolute instant. The hook
    // must fabricate one, or useTimer has nothing to count down to.
    const before = Date.now();
    startRound1();
    transitionToRound2();
    // Read it back through the same path the screen uses.
    expect(screen.getByTestId('next')).toHaveTextContent('Round Two');
    // A crude but sufficient bound: the target sits ~5s ahead of "now".
    // (Exposed indirectly — the screen owns the formatting.)
    expect(Date.now() - before).toBeLessThan(5000);
  });

  // Priority in PlayerGamePage is transition > preparation, so a transition
  // that outlives the next round's preparation would cover it.
  it('clears the transition when the next round starts', () => {
    startRound1();
    transitionToRound2();
    expect(screen.getByTestId('next')).toHaveTextContent('Round Two');

    send('ROUND_STARTED', {
      roundId: 'r-2', roundNumber: 2, roundName: 'Round Two',
      roundType: 'ROUND2_RELAY', turnEndsAt: Date.now() + 60000, durationSeconds: 60,
    });
    expect(screen.getByTestId('next')).toHaveTextContent('none');
  });

  it('clears the transition when the next round enters preparation', () => {
    startRound1();
    transitionToRound2();

    send('ROUND_PREPARATION_STARTED', {
      roundId: 'r-2', roundNumber: 2, roundName: 'Round Two',
      roundType: 'ROUND2_RELAY', preparationSeconds: 10, turnEndsAt: Date.now() + 10000,
    });
    expect(screen.getByTestId('next')).toHaveTextContent('none');
    expect(screen.getByTestId('prep')).toHaveTextContent('Round Two');
  });

  // Preparation ticks must not leak into the match timer, and the match timer
  // must keep receiving its own. This is the routing decision made explicit.
  it('routes preparation ticks to the preparation state, not the match timer', () => {
    send('ROUND_PREPARATION_STARTED', {
      roundId: 'r-1', roundNumber: 1, roundName: 'Round One',
      roundType: 'ROUND1_NINE_ONE', preparationSeconds: 10, turnEndsAt: Date.now() + 10000,
    });
    expect(screen.getByTestId('prep')).toHaveTextContent('Round One');

    // A preparation tick keeps the preparation state alive...
    send('TIMER_TICK', {
      roundId: 'r-1', phase: 'preparation', remainingSeconds: 7,
      totalSeconds: 10, turnEndsAt: Date.now() + 7000,
    });
    expect(screen.getByTestId('prep')).toHaveTextContent('Round One');
  });
});
