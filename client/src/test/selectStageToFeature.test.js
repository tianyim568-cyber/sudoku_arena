// Unit tests for selectStageToFeature — the rule that picks which stage the
// big-screen "stage ranking" view shows.
//
// This mirrors selectRoundToFeature.test.js, one level coarser: we pick a
// stage (not a round inside a stage). The rule is simpler — no PAUSED state
// for stages, no nested rounds to walk — but the shape of the test file is
// the same so a reader who has seen one can navigate the other.
//
// Ground-truth status values (from engine/StageManager.js — the server
// writes these exact strings, no mapping layer): WAITING, RUNNING,
// FINISHED. Unknown statuses ('PAUSED', 'PENDING') do NOT match any branch
// — they fall through to the empty state, which is the honest behavior.

import { describe, it, expect } from 'vitest';
import { selectStageToFeature } from '../utils/selectStageToFeature';

const mkStage = (id, order, status, type = 'INDIVIDUAL') => ({
  id, orderNumber: order, type, status, rounds: [],
});

describe('selectStageToFeature — priority: RUNNING first', () => {
  it('picks the RUNNING stage when one is live', () => {
    const stages = [
      mkStage('s1', 1, 'FINISHED'),
      mkStage('s2', 2, 'RUNNING'),
      mkStage('s3', 3, 'WAITING'),
    ];
    const result = selectStageToFeature(stages);
    expect(result.id).toBe('s2');
  });

  it('picks the first RUNNING stage if two appear (defensive — server should not allow it)', () => {
    // The orchestrator refuses to start a second stage while one is RUNNING,
    // but if the invariant ever breaks, the first in iteration order wins —
    // deterministic, no flicker.
    const stages = [
      mkStage('s1', 1, 'RUNNING'),
      mkStage('s2', 2, 'RUNNING'),
    ];
    const result = selectStageToFeature(stages);
    expect(result.id).toBe('s1');
  });

  it('does NOT pick a WAITING stage even if it is the only one with rankings', () => {
    // A WAITING stage with rankings is suspicious (rankings before the stage
    // starts?), but even if the server sends it, the room wants the live or
    // last-finished stage — not one that has not started.
    const stages = [
      { ...mkStage('s1', 1, 'WAITING'), finalRankings: [{ rank: 1 }] },
    ];
    expect(selectStageToFeature(stages)).toBeNull();
  });
});

describe('selectStageToFeature — priority: FINISHED (most recent) second', () => {
  it('picks the most recently FINISHED stage when nothing is running', () => {
    // Three stages: s1 finished, s2 finished, s3 waiting. The latest in
    // schedule is s2 (higher orderNumber) — that is the one the room wants.
    const stages = [
      mkStage('s1', 1, 'FINISHED'),
      mkStage('s2', 2, 'FINISHED'),
      mkStage('s3', 3, 'WAITING'),
    ];
    const result = selectStageToFeature(stages);
    expect(result.id).toBe('s2');
  });

  it('picks the only FINISHED stage when others are WAITING', () => {
    const stages = [
      mkStage('s1', 1, 'WAITING'),
      mkStage('s2', 2, 'FINISHED'),
      mkStage('s3', 3, 'WAITING'),
    ];
    const result = selectStageToFeature(stages);
    expect(result.id).toBe('s2');
  });

  it('does NOT prefer a FINISHED stage over a RUNNING one earlier in the schedule', () => {
    // Sanity: the rule walks RUNNING first, then FINISHED. A finished stage
    // in position 2 must not beat a running stage in position 1.
    const stages = [
      mkStage('s1', 1, 'RUNNING'),
      mkStage('s2', 2, 'FINISHED'),
    ];
    const result = selectStageToFeature(stages);
    expect(result.id).toBe('s1');
  });
});

describe('selectStageToFeature — empty states', () => {
  it('returns null when there are no stages', () => {
    expect(selectStageToFeature([])).toBeNull();
  });

  it('returns null when every stage is WAITING (competition has not started)', () => {
    const stages = [
      mkStage('s1', 1, 'WAITING'),
      mkStage('s2', 2, 'WAITING'),
    ];
    expect(selectStageToFeature(stages)).toBeNull();
  });

  it('returns null when stages is not an array', () => {
    // Defensive — the parent guards with Array.isArray, but the function
    // must not throw if called directly with bad input.
    expect(selectStageToFeature(null)).toBeNull();
    expect(selectStageToFeature(undefined)).toBeNull();
    expect(selectStageToFeature({})).toBeNull();
    expect(selectStageToFeature('not-an-array')).toBeNull();
  });
});

describe('selectStageToFeature — unknown status values do not match', () => {
  // Stages use WAITING / RUNNING / FINISHED. A stage with an unknown status
  // (PAUSED, PENDING, anything stale or future) must not match as RUNNING
  // or FINISHED — it falls through to the empty state, which is honest.
  it('does NOT match PAUSED (unknown for stages)', () => {
    const stages = [mkStage('s1', 1, 'PAUSED')];
    expect(selectStageToFeature(stages)).toBeNull();
  });

  it('does NOT match PENDING (stale value)', () => {
    const stages = [mkStage('s1', 1, 'PENDING')];
    expect(selectStageToFeature(stages)).toBeNull();
  });

  it('does NOT match IN_PROGRESS for a stage (IN_PROGRESS is a round status, not a stage status)', () => {
    // Stages use RUNNING; rounds use IN_PROGRESS. If a stage ever carries
    // IN_PROGRESS (a bug), we must not treat it as live.
    const stages = [mkStage('s1', 1, 'IN_PROGRESS')];
    expect(selectStageToFeature(stages)).toBeNull();
  });
});

describe('selectStageToFeature — does not filter by rankings.length', () => {
  // A stage that is RUNNING but has zero finalRankings rows yet is still
  // the stage to feature — the room needs to see "Stage 2 — ranking not
  // computed yet" rather than the previous stage's stale board. The caller
  // decides the empty-rankings presentation; the selector only picks the
  // stage.
  it('picks a RUNNING stage even if it has zero ranking rows', () => {
    const stages = [
      mkStage('s1', 1, 'FINISHED'),
      { ...mkStage('s2', 2, 'RUNNING'), finalRankings: [] },
    ];
    const result = selectStageToFeature(stages);
    expect(result.id).toBe('s2');
  });

  it('picks a FINISHED stage even if it has zero ranking rows (rankings not computed yet)', () => {
    const stages = [
      { ...mkStage('s1', 1, 'FINISHED'), finalRankings: [] },
    ];
    const result = selectStageToFeature(stages);
    expect(result.id).toBe('s1');
  });
});
