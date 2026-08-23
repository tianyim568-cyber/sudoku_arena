// Unit tests for chooseScreen — the pure function that decides which player
// screen to show.
//
// The contract pinned down here, as a TABLE: one row per state combination,
// next column is the expected screen. If someone reorders the branches in
// chooseScreen.js, at least one row must fail — that is the success criterion
// for this file.
//
// Rows are grouped by the screen they expect. Within each group, the rows
// vary the *irrelevant* inputs to prove the function doesn't accidentally
// depend on them (e.g., TRANSITION must win whether or not currentRound is
// set, whether or not puzzles arrived).
//
// The rows that protect against permutation:
//   - TRANSITION wins over PREPARATION and over a live round with data and
//     over terminal states (stageFinished/competitionFinished).
//     Move PREPARATION above TRANSITION → "transition + preparation" fails.
//     Move STAGE_FINISHED above TRANSITION → "transition + stageFinished" fails.
//   - PREPARATION wins over a live round with data and over terminal states.
//     Move ROUND1_VIEW above PREPARATION → "preparation + R1 with puzzles" fails.
//     Move STAGE_FINISHED above PREPARATION → "preparation + stageFinished" fails.
//   - ROUND_LOADING wins over WAITING when currentRound is set, AND over
//     terminal states.
//     Remove ROUND_LOADING or put it below WAITING → "R1 active, no puzzles" fails.
//     Put STAGE_FINISHED above ROUND_LOADING → "R1 + stageFinished" fails.
//   - COMPETITION_FINISHED wins over STAGE_FINISHED (server emits both for
//     the last stage; competition-end supersedes stage-end).
//     Swap their order → "competitionFinished + stageFinished" fails.
//   - WAITING wins when nothing is set, including when the two new fields
//     sit at their defaults (null/false).
//     Move STAGE_FINISHED above WAITING without guarding on stageFinished
//     → "stageFinished null + competitionFinished false" fails.
//
// The three ROUND_VIEW rows (R1/R2/R3) are mutually exclusive via roundType,
// so permuting them doesn't change the nominal cases — but the rows still
// pin the data-arrival condition for each (puzzles for R1, round2State for
// R2, round3State for R3). Drop a condition and the ROUND_LOADING row for
// that round type breaks.

import { describe, it, expect } from 'vitest';
import { chooseScreen } from '../pages/chooseScreen';

// ─── Fixtures ────────────────────────────────────────────────────────────
// Reused across rows so each row reads as a decision, not a data setup.

const TRANSITION = { finishedRound: null, nextRound: {}, durationSeconds: 5, turnEndsAt: Date.now() + 5000 };
const PREPARATION = { roundId: 'r-1', roundNumber: 1, roundName: 'QF', roundType: 'ROUND1_NINE_ONE', durationSeconds: 10, turnEndsAt: Date.now() + 10000 };
const R1 = { roundId: 'r-1', roundType: 'ROUND1_NINE_ONE' };
const R2 = { roundId: 'r-2', roundType: 'ROUND2_RELAY' };
const R3 = { roundId: 'r-3', roundType: 'ROUND3_COLLABORATE' };
const PUZZLES = [{ puzzleId: 'p-1' }];
const R2_STATE = { teamScore: 0 };
const R3_STATE = { teamScore: 0, puzzles: [] };
// A stage-end state — { stageOrder, stageType }, the shape useGameSocket
// builds from STAGE_FINISHED. stageOrder is 1-based; stageType is
// INDIVIDUAL / TEAM / null. Both fields are optional in the payload.
const STAGE_FINISHED_STATE = { stageOrder: 1, stageType: 'INDIVIDUAL' };

// Helper: build a state snapshot from partial inputs.
function state(overrides = {}) {
  return {
    transition: null,
    preparation: null,
    currentRound: null,
    puzzles: [],
    round2State: null,
    round3State: null,
    stageFinished: null,
    competitionFinished: false,
    ...overrides,
  };
}

// ─── The table ───────────────────────────────────────────────────────────
// Each row: { name, state, expected }. `expected` is the screen identifier
// chooseScreen must return.
const TABLE = [
  // ── TRANSITION (priority 1) ────────────────────────────────────────────
  // Transition alone.
  { name: 'transition only → TRANSITION',
    state: state({ transition: TRANSITION }),
    expected: 'TRANSITION' },
  // Transition wins over preparation (defensive — both set should never
  // happen, but transition must win if it does).
  { name: 'transition + preparation → TRANSITION',
    state: state({ transition: TRANSITION, preparation: PREPARATION }),
    expected: 'TRANSITION' },
  // Transition wins over a live round with its data arrived.
  { name: 'transition + R1 live with puzzles → TRANSITION',
    state: state({ transition: TRANSITION, currentRound: R1, puzzles: PUZZLES }),
    expected: 'TRANSITION' },
  // Transition wins even if no round is active (the normal case: the round
  // just ended, currentRound may already be stale).
  { name: 'transition + no current round → TRANSITION',
    state: state({ transition: TRANSITION }),
    expected: 'TRANSITION' },

  // ── PREPARATION (priority 2) ───────────────────────────────────────────
  // Preparation alone.
  { name: 'preparation only → PREPARATION',
    state: state({ preparation: PREPARATION }),
    expected: 'PREPARATION' },
  // Preparation wins over a live round with data (the round goes live AFTER
  // preparation ends — currentRound may already be set by the time prep
  // starts, but the board isn't live yet).
  { name: 'preparation + R1 live with puzzles → PREPARATION',
    state: state({ preparation: PREPARATION, currentRound: R1, puzzles: PUZZLES }),
    expected: 'PREPARATION' },
  // Preparation wins over R2 / R3 too.
  { name: 'preparation + R2 live with state → PREPARATION',
    state: state({ preparation: PREPARATION, currentRound: R2, round2State: R2_STATE }),
    expected: 'PREPARATION' },

  // ── ROUND1_VIEW (priority 3) ───────────────────────────────────────────
  // R1 active with puzzles arrived.
  { name: 'R1 live with puzzles → ROUND1_VIEW',
    state: state({ currentRound: R1, puzzles: PUZZLES }),
    expected: 'ROUND1_VIEW' },
  // R1 with puzzles must NOT depend on round2State/round3State.
  { name: 'R1 live with puzzles, R3 state also present → ROUND1_VIEW',
    state: state({ currentRound: R1, puzzles: PUZZLES, round3State: R3_STATE }),
    expected: 'ROUND1_VIEW' },

  // ── ROUND2_VIEW (priority 3) ───────────────────────────────────────────
  { name: 'R2 live with round2State → ROUND2_VIEW',
    state: state({ currentRound: R2, round2State: R2_STATE }),
    expected: 'ROUND2_VIEW' },

  // ── ROUND3_VIEW (priority 3) ───────────────────────────────────────────
  { name: 'R3 live with round3State → ROUND3_VIEW',
    state: state({ currentRound: R3, round3State: R3_STATE }),
    expected: 'ROUND3_VIEW' },

  // ── ROUND_LOADING (priority 4) — the bug fix ──────────────────────────
  // R1 active but puzzles haven't arrived. Before the refactor, this fell
  // through to WAITING, which told the player the competition hadn't
  // started — in the middle of a live round.
  { name: 'R1 live, no puzzles → ROUND_LOADING (not WAITING)',
    state: state({ currentRound: R1, puzzles: [] }),
    expected: 'ROUND_LOADING' },
  // R2 active but round2State hasn't arrived.
  { name: 'R2 live, no round2State → ROUND_LOADING',
    state: state({ currentRound: R2, round2State: null }),
    expected: 'ROUND_LOADING' },
  // R3 active but round3State hasn't arrived.
  { name: 'R3 live, no round3State → ROUND_LOADING',
    state: state({ currentRound: R3, round3State: null }),
    expected: 'ROUND_LOADING' },
  // ROUND_LOADING wins over WAITING: even with everything else null, an
  // active round means "I don't know yet", not "nothing is happening".
  { name: 'R1 live, no puzzles, no prep, no transition → ROUND_LOADING',
    state: state({ currentRound: R1 }),
    expected: 'ROUND_LOADING' },

  // ── WAITING (priority 7, default) ──────────────────────────────────────
  // Nothing active — the honest "waiting for judge" case.
  { name: 'everything null → WAITING',
    state: state(),
    expected: 'WAITING' },
  // Puzzles present but no currentRound — shouldn't happen in practice, but
  // WAITING is the right answer (we're not in a round).
  { name: 'puzzles but no currentRound → WAITING',
    state: state({ puzzles: PUZZLES }),
    expected: 'WAITING' },
  // round2State present but no currentRound — same defensive stance.
  { name: 'round2State but no currentRound → WAITING',
    state: state({ round2State: R2_STATE }),
    expected: 'WAITING' },

  // ── STAGE_FINISHED (priority 6) ────────────────────────────────────────
  // Stage just ended, judge hasn't started the next stage yet. No countdown
  // — the judge decides. Must NOT fall through to WAITING: a stage that just
  // ended is not the same as a competition that hasn't begun.
  { name: 'stageFinished only → STAGE_FINISHED',
    state: state({ stageFinished: STAGE_FINISHED_STATE }),
    expected: 'STAGE_FINISHED' },
  // stageFinished with stageType TEAM — the label changes, the screen doesn't.
  { name: 'stageFinished TEAM → STAGE_FINISHED',
    state: state({ stageFinished: { stageOrder: 2, stageType: 'TEAM' } }),
    expected: 'STAGE_FINISHED' },
  // stageFinished with null stageOrder/stageType (minimal payload) — still
  // STAGE_FINISHED. Proves the branch doesn't depend on payload fields.
  { name: 'stageFinished minimal payload → STAGE_FINISHED',
    state: state({ stageFinished: { stageOrder: null, stageType: null } }),
    expected: 'STAGE_FINISHED' },

  // ── COMPETITION_FINISHED (priority 5) ───────────────────────────────────
  // Competition just ended. Terminal screen, no rankings shown.
  { name: 'competitionFinished only → COMPETITION_FINISHED',
    state: state({ competitionFinished: true }),
    expected: 'COMPETITION_FINISHED' },
  // Competition wins over stageFinished: the server commonly emits
  // STAGE_FINISHED for the last stage followed by COMPETITION_FINISHED.
  // useGameSocket clears stageFinished on COMPETITION_FINISHED, but this is
  // the defensive guard in case the clearing ever misses.
  { name: 'competitionFinished + stageFinished → COMPETITION_FINISHED',
    state: state({ competitionFinished: true, stageFinished: STAGE_FINISHED_STATE }),
    expected: 'COMPETITION_FINISHED' },

  // ── Defensive: live events beat terminal states ────────────────────────
  // A live event (transition/preparation/round) must win over a terminal
  // state (stageFinished/competitionFinished) in case the clearing in
  // useGameSocket hasn't run yet. If someone moves STAGE_FINISHED or
  // COMPETITION_FINISHED above the live-event branches, these rows break.
  { name: 'transition + stageFinished → TRANSITION (live beats terminal)',
    state: state({ transition: TRANSITION, stageFinished: STAGE_FINISHED_STATE }),
    expected: 'TRANSITION' },
  { name: 'transition + competitionFinished → TRANSITION (live beats terminal)',
    state: state({ transition: TRANSITION, competitionFinished: true }),
    expected: 'TRANSITION' },
  { name: 'preparation + stageFinished → PREPARATION (live beats terminal)',
    state: state({ preparation: PREPARATION, stageFinished: STAGE_FINISHED_STATE }),
    expected: 'PREPARATION' },
  // An active round with its data arrived beats a terminal state too.
  { name: 'R1 live with puzzles + stageFinished → ROUND1_VIEW (live beats terminal)',
    state: state({ currentRound: R1, puzzles: PUZZLES, stageFinished: STAGE_FINISHED_STATE }),
    expected: 'ROUND1_VIEW' },
  // An active round with NO data beats a terminal state (ROUND_LOADING, not
  // STAGE_FINISHED). Proves ROUND_LOADING ranks above the terminal branches.
  { name: 'R1 live, no puzzles, + stageFinished → ROUND_LOADING (live beats terminal)',
    state: state({ currentRound: R1, puzzles: [], stageFinished: STAGE_FINISHED_STATE }),
    expected: 'ROUND_LOADING' },

  // ── No-regression: new fields at defaults still fall to WAITING ─────────
  // The two new fields default to null/false. With nothing else set, WAITING
  // must still win — proves the new branches don't accidentally fire when
  // the terminal states aren't actually active.
  { name: 'stageFinished null + competitionFinished false → WAITING (no regression)',
    state: state({ stageFinished: null, competitionFinished: false }),
    expected: 'WAITING' },
];

// ─── The test runner ─────────────────────────────────────────────────────
// One `it` per table row. The row's name is the test name, so a failure
// points straight at the state combination that broke.
describe('chooseScreen — decision table', () => {
  for (const row of TABLE) {
    it(row.name, () => {
      expect(chooseScreen(row.state)).toBe(row.expected);
    });
  }
});
