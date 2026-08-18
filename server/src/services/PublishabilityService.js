/**
 * publishability.js — pure rule that decides whether a competition is ready
 * to be published.
 *
 * Louise's rule (PROMPT_AGENT_PUBLICATION.md):
 *
 *   A competition is publishable when ALL of the following are true:
 *     1. at least one judge has been added
 *     2. at least one participant has been added
 *     3. at least one stage exists
 *     4. AND every existing stage has its rounds configured
 *
 * "Configured" for a stage means: the stage has at least one round, and
 * every round in the stage has at least one puzzle attached. A stage with
 * zero rounds is not ready. A round with zero puzzles is not ready either.
 *
 * IMPORTANT: this is NOT a switch that flips once. If the admin publishes
 * and then adds a new stage without configuring it, the competition is no
 * longer publishable. The rule is recomputed from the real state every
 * time. The status column stores "PUBLISHED" but the rule is what decides
 * whether the Start button is active.
 *
 * "All stages have been added" is NOT verifiable — the system cannot know
 * that the admin is done adding stages. This function does not pretend to
 * check that. It only checks the stages that actually exist.
 *
 * The function is pure: it takes a snapshot of the competition's stages,
 * participants, and judges, and returns { publishable, missing: [...] }.
 * The caller is responsible for fetching the snapshot. This separation
 * makes the rule trivially testable without a database.
 */

/**
 * @typedef {Object} PublishabilityStage
 * @property {string} id
 * @property {string} type
 * @property {number} order_number
 * @property {Array<{ id: string, puzzles?: Array<unknown> }>} rounds
 */

/**
 * @typedef {Object} PublishabilitySnapshot
 * @property {Array<{ id: string }>} judges
 * @property {Array<{ id: string }>} participants
 * @property {PublishabilityStage[]} stages
 */

/**
 * Evaluate whether a competition is publishable.
 *
 * @param {PublishabilitySnapshot} snapshot
 * @returns {{ publishable: boolean, missing: string[] }}
 *   `missing` is an array of stable machine-readable codes identifying each
 *   unmet criterion. The caller maps them to localised strings. Stable
 *   codes mean tests do not break when a message wording changes.
 *   Codes:
 *     - 'NO_JUDGE'        — no judge assigned
 *     - 'NO_PARTICIPANT'  — no participant added
 *     - 'NO_STAGE'        — zero stages exist
 *     - 'STAGE_EMPTY'     — at least one stage has zero rounds
 *     - 'ROUND_EMPTY'     — at least one round has zero puzzles
 */
function evaluatePublishability(snapshot) {
  const missing = [];

  const judges = Array.isArray(snapshot?.judges) ? snapshot.judges : [];
  const participants = Array.isArray(snapshot?.participants) ? snapshot.participants : [];
  const stages = Array.isArray(snapshot?.stages) ? snapshot.stages : [];

  if (judges.length === 0) missing.push('NO_JUDGE');
  if (participants.length === 0) missing.push('NO_PARTICIPANT');
  if (stages.length === 0) {
    missing.push('NO_STAGE');
    // No stages → no per-stage checks make sense. Return early.
    return { publishable: false, missing };
  }

  // Per-stage checks. We do not stop at the first failing stage: we want
  // the report to mention every blocker the admin needs to fix, not just
  // the first one. The order of the missing codes follows the stage order,
  // so the admin reads them top-to-bottom on the page.
  let anyStageEmpty = false;
  let anyRoundEmpty = false;
  for (const stage of stages) {
    const rounds = Array.isArray(stage?.rounds) ? stage.rounds : [];
    if (rounds.length === 0) {
      anyStageEmpty = true;
      continue; // a stage with no rounds has no rounds to check for puzzles
    }
    for (const round of rounds) {
      const puzzles = Array.isArray(round?.puzzles) ? round.puzzles : [];
      if (puzzles.length === 0) {
        anyRoundEmpty = true;
      }
    }
  }
  if (anyStageEmpty) missing.push('STAGE_EMPTY');
  if (anyRoundEmpty) missing.push('ROUND_EMPTY');

  return { publishable: missing.length === 0, missing };
}

module.exports = { evaluatePublishability };
