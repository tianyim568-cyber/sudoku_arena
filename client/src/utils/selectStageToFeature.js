/**
 * selectStageToFeature — picks which stage the big-screen "stage ranking"
 * view should show.
 *
 * Why this is a separate module: the selection rule is the piece that
 * matters most (the prompt names it as the case to test), and it is easier
 * to pin in isolation than through a render. The component consumes the
 * result; the tests exercise the rule directly. This mirrors
 * selectRoundToFeature — same rationale, coarser granularity.
 *
 * The rule, in priority order:
 *
 *   1. A RUNNING stage — the room wants to see the aggregate ranking of the
 *      stage being played right now.
 *   2. The most recently FINISHED stage — when nothing is running, the room
 *      wants the last known stage results, not a blank screen. "Most recent"
 *      is decided by `orderNumber` ascending: a higher-ordered stage is
 *      later in the schedule, so the last FINISHED stage in iteration order
 *      is the latest one.
 *
 * Status values: the server writes 'WAITING', 'RUNNING', 'FINISHED' for
 * stages (engine/StageManager.js). We match those strings exactly. Unknown
 * statuses ('PAUSED', 'PENDING', anything stale or future) do not match
 * any branch and fall through to the empty state — the honest behavior
 * (we do not know what to show, so we say so).
 *
 * Return shape:
 *   stage — the stage object from the snapshot, so the caller has the
 *      stage id, orderNumber, type and status for the header.
 *   null — no stage matches. The caller renders the empty state.
 *
 * We do NOT filter by `finalRankings.length` here. A stage that is RUNNING
 * but has zero ranking rows yet is still the stage to feature — the room
 * needs to see "Stage 2 — ranking not computed yet" rather than the
 * previous stage's stale board. The caller decides the empty-rankings
 * presentation; the selector only picks the stage.
 */

export function selectStageToFeature(stages) {
  if (!Array.isArray(stages) || stages.length === 0) return null;

  // 1: a RUNNING stage. At most one stage is running at a time server-side
  // (GameOrchestrator refuses to start another while one is RUNNING), but
  // we iterate defensively — if two ever appear, the first by order wins.
  for (const stage of stages) {
    if (stage.status === 'RUNNING') return stage;
  }

  // 2: most recently FINISHED stage. Stages are ascending by orderNumber,
  // so the last FINISHED stage in iteration order is the latest in schedule.
  // We walk in reverse to short-circuit.
  for (let si = stages.length - 1; si >= 0; si--) {
    const stage = stages[si];
    if (stage.status === 'FINISHED') return stage;
  }

  return null;
}
