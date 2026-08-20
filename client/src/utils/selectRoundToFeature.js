/**
 * selectRoundToFeature — picks which round the big-screen "round ranking"
 * view should show.
 *
 * Why this is a separate module: the selection rule is the piece that
 * matters most (the prompt names it as the case to test), and it is easier
 * to pin in isolation than through a render. The component consumes the
 * result; the tests exercise the rule directly.
 *
 * The rule, in priority order:
 *
 *   1. An IN_PROGRESS round — the room wants to see the live ranking of the
 *      round being played right now.
 *   2. A PAUSED round — it has a partial ranking, and the room still wants
 *      to see where things stand. (Paused comes after in-progress so a
 *      resumed round does not flicker to a different one.)
 *   3. The most recently FINISHED round — when nothing is live, the room
 *      wants the last known result, not a blank screen. "Most recent" is
 *      decided by stage order, then round order within the stage, both
 *      ascending — a higher-ordered round is later in the schedule.
 *
 * Status values: the server writes 'WAITING', 'IN_PROGRESS', 'PAUSED',
 * 'FINISHED' for rounds (engine/RoundManager.js). We match those strings
 * exactly. The stale values 'PENDING' and 'NOT_STARTED' are not written
 * anymore — the codebase has been bitten by that before, so we do not
 * handle them: a round with a stale status simply does not match any
 * branch and falls through to the empty state, which is the honest
 * behavior (we do not know what to show, so we say so).
 *
 * Return shape:
 *   { stage, round } — the stage and round objects from the snapshot, so
 *      the caller has the round name and the stage label for the header.
 *   null — no round matches. The caller renders the empty state.
 *
 * We do NOT filter by `rankings.length` here. A round that is IN_PROGRESS
 * but has zero rankings yet is still the round to feature — the room needs
 * to see "Round 2 — ranking not available yet" rather than the previous
 * round's stale board. The caller decides the empty-rankings presentation.
 */

const PRIORITY = ['IN_PROGRESS', 'PAUSED'];

export function selectRoundToFeature(stages) {
  if (!Array.isArray(stages) || stages.length === 0) return null;

  // 1 & 2: live or paused round. At most one round is live at a time
  // server-side (GameOrchestrator refuses to start another while one is
  // IN_PROGRESS), but we iterate defensively — if two ever appear, the
  // first by stage/round order wins.
  for (const status of PRIORITY) {
    for (const stage of stages) {
      for (const round of stage.rounds || []) {
        if (round.status === status) return { stage, round };
      }
    }
  }

  // 3: most recently FINISHED round. Stages and rounds are ascending by
  // order, so the last FINISHED round in iteration order is the latest in
  // schedule. We walk stages and rounds in reverse to short-circuit.
  for (let si = stages.length - 1; si >= 0; si--) {
    const stage = stages[si];
    const rounds = stage.rounds || [];
    for (let ri = rounds.length - 1; ri >= 0; ri--) {
      const round = rounds[ri];
      if (round.status === 'FINISHED') return { stage, round };
    }
  }

  return null;
}
