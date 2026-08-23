// Unit tests for selectRoundToFeature — the rule that picks which round the
// big-screen "round ranking" view shows.
//
// This is the case the prompt names as the one that matters: the view must
// pick the expected round, and stay correct when no round has rankings yet.
// We test the rule in isolation so failures point at the logic, not the
// render. The component test (RoundRankingView.test.jsx) covers the
// presentation that consumes this function.
//
// Ground-truth status values (from engine/RoundManager.js — the server
// writes these exact strings, no mapping layer): WAITING, IN_PROGRESS,
// PAUSED, FINISHED. The stale values PENDING and NOT_STARTED are NOT
// written anymore — we do not handle them, so a round with a stale status
// falls through to the empty state (the honest behavior).

import { describe, it, expect } from 'vitest';
import { selectRoundToFeature } from '../utils/selectRoundToFeature';

const mkStage = (id, order, status, rounds) => ({
  id, orderNumber: order, type: 'INDIVIDUAL', status, rounds,
});

const mkRound = (id, order, status, rankings = []) => ({
  id, orderNumber: order, name: `Round ${order}`, status, rankings,
});

const mkRanking = (rank, name) => ({
  rank,
  totalScore: 100 - rank,
  player: { id: `p${rank}`, name, school: 'School', age: 10, category: [{ id: 'c1', name: 'U10' }] },
});

describe('selectRoundToFeature — priority: IN_PROGRESS first', () => {
  it('picks the IN_PROGRESS round when one is live', () => {
    const stages = [
      mkStage('s1', 1, 'FINISHED', [
        mkRound('r1', 1, 'FINISHED', [mkRanking(1, 'Alice')]),
      ]),
      mkStage('s2', 2, 'RUNNING', [
        mkRound('r2', 1, 'WAITING'),
        mkRound('r3', 2, 'IN_PROGRESS', [mkRanking(1, 'Bob')]),
      ]),
    ];
    const result = selectRoundToFeature(stages);
    expect(result.round.id).toBe('r3');
    expect(result.stage.id).toBe('s2');
  });

  it('picks the first IN_PROGRESS round if two appear (defensive — server should not allow it)', () => {
    const stages = [
      mkStage('s1', 1, 'RUNNING', [
        mkRound('r1', 1, 'IN_PROGRESS', [mkRanking(1, 'Alice')]),
      ]),
      mkStage('s2', 2, 'RUNNING', [
        mkRound('r2', 1, 'IN_PROGRESS', [mkRanking(1, 'Bob')]),
      ]),
    ];
    const result = selectRoundToFeature(stages);
    // First in iteration order wins — deterministic, no flicker.
    expect(result.round.id).toBe('r1');
  });

  it('does NOT pick a WAITING round even if it has rankings', () => {
    // A WAITING round with rankings is suspicious (rankings before the round
    // starts?), but even if the server sends it, the room wants the live or
    // last-finished round — not one that has not started.
    const stages = [
      mkStage('s1', 1, 'WAITING', [
        mkRound('r1', 1, 'WAITING', [mkRanking(1, 'Alice')]),
      ]),
    ];
    expect(selectRoundToFeature(stages)).toBeNull();
  });
});

describe('selectRoundToFeature — priority: PAUSED second', () => {
  it('picks a PAUSED round if no IN_PROGRESS round exists', () => {
    // A paused round has a partial ranking — the room still wants to see
    // where things stand.
    const stages = [
      mkStage('s1', 1, 'RUNNING', [
        mkRound('r1', 1, 'PAUSED', [mkRanking(1, 'Alice')]),
      ]),
    ];
    const result = selectRoundToFeature(stages);
    expect(result.round.id).toBe('r1');
  });

  it('prefers IN_PROGRESS over PAUSED', () => {
    const stages = [
      mkStage('s1', 1, 'RUNNING', [
        mkRound('r1', 1, 'PAUSED', [mkRanking(1, 'Alice')]),
        mkRound('r2', 2, 'IN_PROGRESS', [mkRanking(1, 'Bob')]),
      ]),
    ];
    const result = selectRoundToFeature(stages);
    expect(result.round.id).toBe('r2');
  });
});

describe('selectRoundToFeature — priority: FINISHED (most recent) third', () => {
  it('picks the most recently FINISHED round when nothing is live', () => {
    // Two finished rounds across two stages — the later one (higher stage
    // order, higher round order) is the most recent in schedule.
    const stages = [
      mkStage('s1', 1, 'FINISHED', [
        mkRound('r1', 1, 'FINISHED', [mkRanking(1, 'Alice')]),
        mkRound('r2', 2, 'FINISHED', [mkRanking(1, 'Bob')]),
      ]),
      mkStage('s2', 2, 'WAITING', [
        mkRound('r3', 1, 'WAITING'),
      ]),
    ];
    const result = selectRoundToFeature(stages);
    expect(result.round.id).toBe('r2');
  });

  it('picks a FINISHED round from a later stage over one from an earlier stage', () => {
    const stages = [
      mkStage('s1', 1, 'FINISHED', [
        mkRound('r1', 1, 'FINISHED', [mkRanking(1, 'Alice')]),
      ]),
      mkStage('s2', 2, 'FINISHED', [
        mkRound('r2', 1, 'FINISHED', [mkRanking(1, 'Bob')]),
      ]),
    ];
    const result = selectRoundToFeature(stages);
    expect(result.stage.id).toBe('s2');
    expect(result.round.id).toBe('r2');
  });

  it('does NOT prefer a FINISHED round over an IN_PROGRESS one in an earlier stage', () => {
    // Sanity: the rule walks PRIORITY first, then FINISHED. A finished round
    // in stage 1 must not beat a live round in stage 2.
    const stages = [
      mkStage('s1', 1, 'FINISHED', [
        mkRound('r1', 1, 'FINISHED', [mkRanking(1, 'Alice')]),
      ]),
      mkStage('s2', 2, 'RUNNING', [
        mkRound('r2', 1, 'IN_PROGRESS', [mkRanking(1, 'Bob')]),
      ]),
    ];
    const result = selectRoundToFeature(stages);
    expect(result.round.id).toBe('r2');
  });
});

describe('selectRoundToFeature — empty states', () => {
  it('returns null when there are no stages', () => {
    expect(selectRoundToFeature([])).toBeNull();
  });

  it('returns null when every round is WAITING (competition has not started)', () => {
    const stages = [
      mkStage('s1', 1, 'WAITING', [
        mkRound('r1', 1, 'WAITING'),
        mkRound('r2', 2, 'WAITING'),
      ]),
    ];
    expect(selectRoundToFeature(stages)).toBeNull();
  });

  it('returns null when stages have no rounds', () => {
    const stages = [mkStage('s1', 1, 'WAITING', [])];
    expect(selectRoundToFeature(stages)).toBeNull();
  });

  it('returns null when stages is not an array', () => {
    // Defensive — the parent guards with Array.isArray, but the function
    // must not throw if called directly with bad input.
    expect(selectRoundToFeature(null)).toBeNull();
    expect(selectRoundToFeature(undefined)).toBeNull();
    expect(selectRoundToFeature('not-an-array')).toBeNull();
  });
});

describe('selectRoundToFeature — stale status values do not match', () => {
  // The codebase was bitten by stale status values (PENDING, NOT_STARTED)
  // before. The server does not write them anymore, but if one ever shows
  // up, the function must NOT match it as if it were live — that would
  // feature a round that is not actually running. It falls through to the
  // empty state, which is honest.
  it('does NOT match PENDING (stale value)', () => {
    const stages = [
      mkStage('s1', 1, 'PENDING', [
        mkRound('r1', 1, 'PENDING', [mkRanking(1, 'Alice')]),
      ]),
    ];
    expect(selectRoundToFeature(stages)).toBeNull();
  });

  it('does NOT match NOT_STARTED (stale value)', () => {
    const stages = [
      mkStage('s1', 1, 'NOT_STARTED', [
        mkRound('r1', 1, 'NOT_STARTED', [mkRanking(1, 'Alice')]),
      ]),
    ];
    expect(selectRoundToFeature(stages)).toBeNull();
  });

  it('does NOT match RUNNING for a round (RUNNING is a STAGE status, not a round status)', () => {
    // Stages use RUNNING; rounds use IN_PROGRESS. If a round ever carries
    // RUNNING (a bug), we must not treat it as live.
    const stages = [
      mkStage('s1', 1, 'RUNNING', [
        mkRound('r1', 1, 'RUNNING', [mkRanking(1, 'Alice')]),
      ]),
    ];
    expect(selectRoundToFeature(stages)).toBeNull();
  });
});

describe('selectRoundToFeature — does not filter by rankings.length', () => {
  // The prompt: "reste correcte quand la manche n'a pas encore de classement."
  // A round that is IN_PROGRESS but has zero rankings (nobody has submitted
  // yet) is still the round to feature — the room needs to see "Round 2 —
  // ranking not available yet" rather than the previous round's stale board.
  // The caller decides the empty-rankings presentation; the selector only
  // picks the round.
  it('picks an IN_PROGRESS round even if it has zero rankings', () => {
    const stages = [
      mkStage('s1', 1, 'FINISHED', [
        mkRound('r1', 1, 'FINISHED', [mkRanking(1, 'Alice')]),
      ]),
      mkStage('s2', 2, 'RUNNING', [
        mkRound('r2', 1, 'IN_PROGRESS', []),
      ]),
    ];
    const result = selectRoundToFeature(stages);
    expect(result.round.id).toBe('r2');
    expect(result.round.rankings).toEqual([]);
  });

  it('picks a FINISHED round even if it has zero rankings (rankings not computed yet)', () => {
    const stages = [
      mkStage('s1', 1, 'FINISHED', [
        mkRound('r1', 1, 'FINISHED', []),
      ]),
    ];
    const result = selectRoundToFeature(stages);
    expect(result.round.id).toBe('r1');
  });
});
