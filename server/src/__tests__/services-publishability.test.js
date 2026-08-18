// Unit tests for evaluatePublishability — the pure rule that decides
// whether a competition is ready to be published.
//
// The rule (PROMPT_AGENT_PUBLICATION.md):
//   publishable iff:
//     1. at least one judge
//     2. at least one participant
//     3. at least one stage
//     4. every stage has at least one round AND every round has at least one puzzle
//
// The most important property: this is NOT a stored flag. It is recomputed
// from the real state every time. If a stage is added after publication,
// the rule must say "not publishable" again. We pin that here.

const { evaluatePublishability } = require('../services/PublishabilityService');

// Helper — a fully ready snapshot. Each test below mutates one field at a
// time to break exactly one criterion, so the missing code is unambiguous.
function readySnapshot() {
  return {
    judges: [{ id: 'j1' }],
    participants: [{ id: 'p1' }],
    stages: [
      {
        id: 's1', type: 'TEAM', order_number: 1,
        rounds: [
          { id: 'r1', puzzles: [{ id: 'pz1' }] },
        ],
      },
    ],
  };
}

describe('evaluatePublishability — happy path', () => {
  test('a fully configured competition is publishable', () => {
    const { publishable, missing } = evaluatePublishability(readySnapshot());
    expect(publishable).toBe(true);
    expect(missing).toEqual([]);
  });

  test('a stage with multiple rounds, all with puzzles, is publishable', () => {
    const snap = readySnapshot();
    snap.stages[0].rounds.push({ id: 'r2', puzzles: [{ id: 'pz2' }, { id: 'pz3' }] });
    const { publishable, missing } = evaluatePublishability(snap);
    expect(publishable).toBe(true);
    expect(missing).toEqual([]);
  });

  test('multiple stages, all configured, is publishable', () => {
    const snap = readySnapshot();
    snap.stages.push({
      id: 's2', type: 'INDIVIDUAL', order_number: 2,
      rounds: [{ id: 'r3', puzzles: [{ id: 'pz4' }] }],
    });
    const { publishable, missing } = evaluatePublishability(snap);
    expect(publishable).toBe(true);
    expect(missing).toEqual([]);
  });
});

describe('evaluatePublishability — each criterion can block alone', () => {
  test('no judge → NO_JUDGE', () => {
    const snap = readySnapshot();
    snap.judges = [];
    const { publishable, missing } = evaluatePublishability(snap);
    expect(publishable).toBe(false);
    expect(missing).toContain('NO_JUDGE');
    // Only one criterion broken → only one code.
    expect(missing).toEqual(['NO_JUDGE']);
  });

  test('no participant → NO_PARTICIPANT', () => {
    const snap = readySnapshot();
    snap.participants = [];
    const { publishable, missing } = evaluatePublishability(snap);
    expect(publishable).toBe(false);
    expect(missing).toEqual(['NO_PARTICIPANT']);
  });

  test('zero stages → NO_STAGE (and no per-stage checks reported)', () => {
    const snap = readySnapshot();
    snap.stages = [];
    const { publishable, missing } = evaluatePublishability(snap);
    expect(publishable).toBe(false);
    // No stages means STAGE_EMPTY / ROUND_EMPTY do not apply — there are
    // no stages to be empty.
    expect(missing).toEqual(['NO_STAGE']);
  });

  test('a stage with zero rounds → STAGE_EMPTY', () => {
    const snap = readySnapshot();
    snap.stages[0].rounds = [];
    const { publishable, missing } = evaluatePublishability(snap);
    expect(publishable).toBe(false);
    expect(missing).toEqual(['STAGE_EMPTY']);
  });

  test('a round with zero puzzles → ROUND_EMPTY', () => {
    const snap = readySnapshot();
    snap.stages[0].rounds[0].puzzles = [];
    const { publishable, missing } = evaluatePublishability(snap);
    expect(publishable).toBe(false);
    expect(missing).toEqual(['ROUND_EMPTY']);
  });

  test("a round whose puzzles field is missing (undefined) → ROUND_EMPTY", () => {
    // Defensive: a malformed snapshot must not crash the rule, it must
    // treat the round as having zero puzzles.
    const snap = readySnapshot();
    delete snap.stages[0].rounds[0].puzzles;
    const { publishable, missing } = evaluatePublishability(snap);
    expect(publishable).toBe(false);
    expect(missing).toEqual(['ROUND_EMPTY']);
  });
});

describe('evaluatePublishability — the regression that matters', () => {
  // THIS is the case Louise called out: "ce n'est pas un interrupteur qu'on
  // bascule une fois". If the admin publishes and then adds a new stage
  // without configuring it, the competition must STOP being publishable.
  //
  // The function is pure — it does not know about publication, it only
  // looks at the state it is given. So we feed it the state "one configured
  // stage + one new empty stage" and assert it returns not-publishable.
  test('adding an unconfigured stage after publication makes it not publishable', () => {
    // Step 1: ready state.
    const published = readySnapshot();
    expect(evaluatePublishability(published).publishable).toBe(true);

    // Step 2: admin adds a new stage with no rounds.
    published.stages.push({
      id: 's2', type: 'INDIVIDUAL', order_number: 2,
      rounds: [],
    });
    const after = evaluatePublishability(published);
    expect(after.publishable).toBe(false);
    expect(after.missing).toContain('STAGE_EMPTY');
  });

  // Same idea, but the new stage has a round with no puzzles.
  test('adding a stage with a round but no puzzles makes it not publishable', () => {
    const snap = readySnapshot();
    snap.stages.push({
      id: 's2', type: 'INDIVIDUAL', order_number: 2,
      rounds: [{ id: 'r-new', puzzles: [] }],
    });
    const { publishable, missing } = evaluatePublishability(snap);
    expect(publishable).toBe(false);
    expect(missing).toContain('ROUND_EMPTY');
  });

  // Multiple broken criteria at once must all be reported. The admin should
  // see the full punch list, not fix one and reload to discover the next.
  test('every broken criterion is reported (not just the first)', () => {
    const snap = readySnapshot();
    snap.judges = [];
    snap.participants = [];
    snap.stages[0].rounds = []; // STAGE_EMPTY
    // To also get ROUND_EMPTY, add a round with no puzzles in another stage.
    snap.stages.push({
      id: 's2', type: 'INDIVIDUAL', order_number: 2,
      rounds: [{ id: 'r2', puzzles: [] }],
    });
    const { publishable, missing } = evaluatePublishability(snap);
    expect(publishable).toBe(false);
    expect(missing).toEqual(
      expect.arrayContaining(['NO_JUDGE', 'NO_PARTICIPANT', 'STAGE_EMPTY', 'ROUND_EMPTY'])
    );
    expect(missing.length).toBe(4);
  });
});

describe('evaluatePublishability — defensive on malformed input', () => {
  test('null snapshot → not publishable, NO_JUDGE/NO_PARTICIPANT/NO_STAGE', () => {
    const { publishable, missing } = evaluatePublishability(null);
    expect(publishable).toBe(false);
    expect(missing).toEqual(
      expect.arrayContaining(['NO_JUDGE', 'NO_PARTICIPANT', 'NO_STAGE'])
    );
  });

  test('undefined fields are treated as empty arrays, not crashed on', () => {
    const { publishable, missing } = evaluatePublishability({});
    expect(publishable).toBe(false);
    expect(missing).toEqual(
      expect.arrayContaining(['NO_JUDGE', 'NO_PARTICIPANT', 'NO_STAGE'])
    );
  });
});
