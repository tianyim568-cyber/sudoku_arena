/**
 * chooseScreen — pure function that decides which player screen to show.
 *
 * Extracted from PlayerGamePage's former nested-ternary cascade so the rule
 * is readable at a glance and unit-testable. PlayerGamePage calls this and
 * maps the returned identifier to the corresponding component.
 *
 * WHY A FUNCTION (not ternaries in JSX):
 *   - The old cascade buried the rule six levels deep. Someone arriving in
 *     the file couldn't say which screen wins without unwinding the chain.
 *   - A pure function takes the full state snapshot and returns one
 *     identifier. The priority rule lives in one place, in plain English,
 *     next to the code that enforces it.
 *   - It is unit-testable without React/jsdom: one test per state
 *     combination, and any permutation of the branches breaks at least one.
 *
 * THE RULE (read top to bottom, first match wins):
 *
 *   1. TRANSITION   — a round just ended, another follows in a few seconds.
 *                      The countdown must show over everything, even if stale
 *                      round state lingers. useGameSocket clears `transition`
 *                      on ROUND_STARTED and ROUND_PREPARATION_STARTED.
 *                      RANKS ABOVE EVERYTHING: the player must not miss the
 *                      "next round in Xs" countdown because of stale data.
 *
 *   2. PREPARATION  — judge started the round, gameplay hasn't begun. The
 *                      prep countdown must show before the board.
 *                      RANKS ABOVE ROUND VIEWS: preparation is the current
 *                      phase; the board isn't live yet.
 *
 *   3. ROUND_VIEW   — a round is active (currentRound !== null) AND its data
 *                      has arrived:
 *                        R1 → puzzles.length > 0
 *                        R2 → round2State !== null
 *                        R3 → round3State !== null
 *                      RANKS BELOW PREPARATION: once the round goes live,
 *                      preparation is null, so this branch wins naturally.
 *
 *                      NOTE on the R2/R3 conditions: today `useGameSocket`
 *                      initialises round2State/round3State to objects, never
 *                      to null, so in production these two are always true and
 *                      only the R1 condition can actually gate. They are kept
 *                      because the caller is free to pass null (the unit tests
 *                      do), and because a future REST-first mount would.
 *                      Do not read them as "the R2 board waits for its data" —
 *                      it does not, and changing that is a product decision,
 *                      not a refactor.
 *
 *   4. ROUND_LOADING — a round is active (currentRound !== null) BUT its
 *                      data hasn't arrived yet (slow network, missed event,
 *                      page reload). Shows a short, honest "Loading round…"
 *                      message — NOT WaitingScreen, NOT "waiting for judge".
 *                      RANKS ABOVE WAITING: never confuse "nothing is
 *                      happening" with "I don't know yet". This is the bug
 *                      the refactor fixes: before, R1 with currentRound but
 *                      no puzzles fell through to WaitingScreen, which told
 *                      the player the competition hadn't started — in the
 *                      middle of an active round.
 *
 *   5. COMPETITION_FINISHED — the whole competition is over. The server
 *                      emitted COMPETITION_FINISHED. Terminal screen, no
 *                      rankings shown (product decision). RANKS ABOVE
 *                      STAGE_FINISHED: a competition-end supersedes any
 *                      stage-end state that hadn't been cleared.
 *
 *   6. STAGE_FINISHED   — a stage just ended (STAGE_FINISHED), the judge
 *                      hasn't started the next stage yet. No countdown: the
 *                      judge decides when to start the next stage. RANKS
 *                      ABOVE WAITING: a stage that just ended is NOT the
 *                      same as a competition that hasn't begun — the player
 *                      must not see the "waiting for a round" message here.
 *                      RANKS BELOW the live-event branches (1-4): if a new
 *                      round/prep/transition arrives, it wins over the
 *                      terminal state — defensive, in case the clearing in
 *                      useGameSocket hasn't run yet.
 *
 *   7. WAITING      — no active round, no preparation, no transition, no
 *                      stage-end. The player is waiting for the judge to
 *                      start the next round or stage. Honest because
 *                      currentRound is null.
 *
 * MUTUAL EXCLUSION:
 *   - transition and preparation are never both non-null in normal flow
 *     (useGameSocket clears one before setting the other), but transition
 *     wins if both are ever set — defensive.
 *   - isRound1/isRound2/isRound3 derive from currentRound.roundType, so at
 *     most one is true. The three ROUND_VIEW sub-cases don't compete.
 *   - competitionFinished and stageFinished are both cleared whenever a
 *     round/prep/stage starts; if both ever survived to this point,
 *     competitionFinished wins (it's checked first).
 *
 * @param {Object} state
 * @param {Object|null} state.transition
 * @param {Object|null} state.preparation
 * @param {Object|null} state.currentRound
 * @param {Array}      state.puzzles
 * @param {Object|null} state.round2State
 * @param {Object|null} state.round3State
 * @param {Object|null} state.stageFinished
 * @param {boolean}     state.competitionFinished
 * @returns {'TRANSITION'|'PREPARATION'|'ROUND1_VIEW'|'ROUND2_VIEW'|'ROUND3_VIEW'|'INDIVIDUAL_VIEW'|'ROUND_LOADING'|'STAGE_FINISHED'|'COMPETITION_FINISHED'|'WAITING'}
 */

const INDIVIDUAL_ROUND_TYPES = new Set([
  'INDIVIDUAL_STANDARD',
  'INDIVIDUAL_SHAPED',
  'INDIVIDUAL_MIXED',
]);

export function chooseScreen({ transition, preparation, currentRound, puzzles, round2State, round3State, stageFinished, competitionFinished }) {
  // 1. Transition — countdown must show over everything.
  if (transition) return 'TRANSITION';

  // 2. Preparation — prep countdown before the board.
  if (preparation) return 'PREPARATION';

  // 3. Round views — active round with its data arrived.
  if (currentRound) {
    const roundType = currentRound.roundType;
    if (roundType === 'ROUND1_NINE_ONE' && puzzles.length > 0) return 'ROUND1_VIEW';
    if (roundType === 'ROUND2_RELAY' && round2State) return 'ROUND2_VIEW';
    if (roundType === 'ROUND3_COLLABORATE' && round3State) return 'ROUND3_VIEW';
    if (INDIVIDUAL_ROUND_TYPES.has(roundType) && puzzles.length > 0) return 'INDIVIDUAL_VIEW';

    // 4. Round loading — active round, data not here yet.
    //    Falls through to this if currentRound is set but the round-specific
    //    data hasn't arrived (puzzles empty for R1, round2State/round3State
    //    null for R2/R3). Never reach WAITING with an active round.
    return 'ROUND_LOADING';
  }

  // 5. Competition finished — end-of-competition screen.
  //    Checked before STAGE_FINISHED: a competition-end supersedes a
  //    stage-end. The server usually emits STAGE_FINISHED for the last
  //    stage followed by COMPETITION_FINISHED, and useGameSocket clears
  //    stageFinished on COMPETITION_FINISHED; this is the defensive guard
  //    in case the clearing ever misses.
  if (competitionFinished) return 'COMPETITION_FINISHED';

  // 6. Stage finished — end-of-stage screen. The judge decides when the
  //    next stage starts, so there is no countdown. Only reached when no
  //    live round/prep/transition is active — a live event always wins.
  if (stageFinished) return 'STAGE_FINISHED';

  // 7. Waiting — no active round, no prep, no transition, no stage-end.
  return 'WAITING';
}
