// Unit tests for DisplayStageRankingView — the big-screen view for the
// STAGE_RANKING display mode.
//
// The goal of this file: pin that the view renders the stage-level ranking
// correctly — medals for top 3, headlines (冠军/亚军/季军), entity names
// resolved by the server, the stage filter (only rows of the selected stage
// are rendered), the 20-row cap, and honest empty states when no stage
// qualifies or the selected stage has no rows yet.
//
// We test the view in isolation by feeding it a fixture snapshot. The view
// is presentational only — it receives the snapshot in props and touches no
// network — so no socket or fetch mock is needed.
//
// Shape of data (built by DisplayManager.getRankingSnapshot):
//   data.stages[]         — { id, type, orderNumber, status, rounds[] }
//   data.finalRankings[]  — { stageId, categoryId, entityType, entityId,
//                             entityName, school, age, rank, score }
// The view filters finalRankings by the selected stage's id.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DisplayStageRankingView from '../components/DisplayStageRankingView';

const COMPETITION = { id: 'c1', name: 'Spring Cup', status: 'RUNNING', displayMode: 'STAGE_RANKING' };

function makeSnapshot(stages, finalRankings) {
  return {
    competition: COMPETITION,
    categories: [],
    stages,
    finalRankings,
    generatedAt: '2026-08-15T10:00:00.000Z',
  };
}

function renderView(props = {}) {
  return render(
    <DisplayStageRankingView
      data={props.data || makeSnapshot([], [])}
      lastUpdated={null}
      pollIntervalSeconds={10}
      socketConnected={false}
      {...props}
    />
  );
}

const mkStage = (id, order, status, type = 'INDIVIDUAL') => ({
  id, orderNumber: order, type, status, rounds: [],
});

function mkRow(stageId, entityId, entityName, rank, score, extra = {}) {
  return {
    stageId,
    categoryId: null,
    entityType: 'PLAYER',
    entityId,
    entityName,
    school: null,
    age: null,
    rank,
    score,
    ...extra,
  };
}

describe('DisplayStageRankingView — header', () => {
  it('shows the competition name and the stage label', () => {
    const stages = [mkStage('s1', 1, 'RUNNING')];
    renderView({ data: makeSnapshot(stages, []) });
    expect(screen.getByText('Spring Cup')).toBeInTheDocument();
    // The h2 is the only heading of level 2 — its accessible name contains
    // "阶段 1" plus the type label. Asserting via role avoids colliding with
    // the empty-state copy that also contains "阶段 1".
    expect(screen.getByRole('heading', { level: 2, name: /阶段 1/ })).toBeInTheDocument();
  });

  it('renders the footer with the page label', () => {
    const stages = [mkStage('s1', 1, 'FINISHED')];
    const fr = [mkRow('s1', 'p1', 'Alice', 1, 150, { school: 'School A', age: 9 })];
    renderView({ data: makeSnapshot(stages, fr) });
    expect(screen.getByText(/数独竞技场 — 阶段排名/)).toBeInTheDocument();
  });

  it('shows the socket status when connected', () => {
    const stages = [mkStage('s1', 1, 'FINISHED')];
    const fr = [mkRow('s1', 'p1', 'Alice', 1, 150)];
    renderView({ data: makeSnapshot(stages, fr), socketConnected: true });
    expect(screen.getByText(/实时连接/)).toBeInTheDocument();
  });

  it('shows the poll interval when socket is down', () => {
    const stages = [mkStage('s1', 1, 'FINISHED')];
    const fr = [mkRow('s1', 'p1', 'Alice', 1, 150)];
    renderView({ data: makeSnapshot(stages, fr), socketConnected: false, pollIntervalSeconds: 10 });
    expect(screen.getByText(/每 10 秒自动刷新/)).toBeInTheDocument();
  });
});

describe('DisplayStageRankingView — stage selection drives the view', () => {
  it('shows the "no stage" empty state when only WAITING stages exist', () => {
    const stages = [mkStage('s1', 1, 'WAITING')];
    renderView({ data: makeSnapshot(stages, []) });
    expect(screen.getByText('暂无进行中或已结束的阶段')).toBeInTheDocument();
  });

  it('shows the "no rows yet" empty state when a RUNNING stage has no finalRankings rows', () => {
    const stages = [mkStage('s1', 1, 'RUNNING')];
    renderView({ data: makeSnapshot(stages, []) });
    expect(screen.getByText(/「阶段 1」暂无排名数据/)).toBeInTheDocument();
  });

  it('shows the "no rows yet" empty state when a FINISHED stage has no rows', () => {
    const stages = [mkStage('s1', 1, 'FINISHED')];
    renderView({ data: makeSnapshot(stages, []) });
    expect(screen.getByText(/「阶段 1」暂无排名数据/)).toBeInTheDocument();
  });
});

describe('DisplayStageRankingView — podium (top 3)', () => {
  it('renders each podium entity with its name', () => {
    const stages = [mkStage('s1', 1, 'RUNNING')];
    const fr = [
      mkRow('s1', 'p1', 'Alice', 1, 150, { school: 'School A', age: 9 }),
      mkRow('s1', 'p2', 'Bob', 2, 120, { school: 'School B', age: 10 }),
      mkRow('s1', 'p3', 'Cécile', 3, 95, { school: 'School C', age: 11 }),
    ];
    renderView({ data: makeSnapshot(stages, fr) });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Cécile')).toBeInTheDocument();
  });

  it('renders the headlines 冠军 / 亚军 / 季军 for ranks 1, 2, 3', () => {
    const stages = [mkStage('s1', 1, 'RUNNING')];
    const fr = [
      mkRow('s1', 'p1', 'Alice', 1, 150),
      mkRow('s1', 'p2', 'Bob', 2, 120),
      mkRow('s1', 'p3', 'Cécile', 3, 95),
    ];
    renderView({ data: makeSnapshot(stages, fr) });
    expect(screen.getByText('冠军')).toBeInTheDocument();
    expect(screen.getByText('亚军')).toBeInTheDocument();
    expect(screen.getByText('季军')).toBeInTheDocument();
  });

  it('renders the school and age for each podium entity', () => {
    const stages = [mkStage('s1', 1, 'RUNNING')];
    const fr = [
      mkRow('s1', 'p1', 'Alice', 1, 150, { school: 'School A', age: 9 }),
      mkRow('s1', 'p2', 'Bob', 2, 120, { school: 'School B', age: 10 }),
    ];
    renderView({ data: makeSnapshot(stages, fr) });
    expect(screen.getByText('School A')).toBeInTheDocument();
    expect(screen.getByText('9岁')).toBeInTheDocument();
    expect(screen.getByText('School B')).toBeInTheDocument();
    expect(screen.getByText('10岁')).toBeInTheDocument();
  });

  it('renders the rank numbers 1, 2, 3 inside the medal badges', () => {
    const { container } = renderView({
      data: makeSnapshot(
        [mkStage('s1', 1, 'RUNNING')],
        [
          mkRow('s1', 'p1', 'Alice', 1, 150),
          mkRow('s1', 'p2', 'Bob', 2, 120),
          mkRow('s1', 'p3', 'Cécile', 3, 95),
        ],
      ),
    });
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    // Sanity-check the medal CSS classes are applied — gold/silver/bronze.
    expect(container.querySelector('.bg-yellow-500')).toBeTruthy();
    expect(container.querySelector('.bg-gray-300')).toBeTruthy();
    expect(container.querySelector('.bg-amber-700')).toBeTruthy();
  });
});

describe('DisplayStageRankingView — stageId filter', () => {
  it('renders ONLY rows of the selected stage (rows of other stages are absent)', () => {
    // Two stages: s1 RUNNING (selected) and s2 FINISHED. Rows for s2 must
    // not leak into the view even though s2 is FINISHED — the filter is by
    // the SELECTED stage, not by "all stages with rows".
    const stages = [
      mkStage('s1', 1, 'RUNNING'),
      mkStage('s2', 2, 'FINISHED'),
    ];
    const fr = [
      mkRow('s1', 'p1', 'Alice (stage1)', 1, 150),
      mkRow('s2', 'p2', 'Bob (stage2)', 1, 200),
    ];
    renderView({ data: makeSnapshot(stages, fr) });
    expect(screen.getByText('Alice (stage1)')).toBeInTheDocument();
    expect(screen.queryByText('Bob (stage2)')).not.toBeInTheDocument();
  });
});

describe('DisplayStageRankingView — teams', () => {
  it('renders a team entity with the 队伍 label and no school/age', () => {
    const stages = [mkStage('s1', 1, 'RUNNING', 'TEAM')];
    const fr = [
      mkRow('s1', 't1', 'Team Alpha', 1, 200, { entityType: 'TEAM', school: null, age: null }),
    ];
    renderView({ data: makeSnapshot(stages, fr) });
    expect(screen.getByText('Team Alpha')).toBeInTheDocument();
    expect(screen.getByText('队伍')).toBeInTheDocument();
    // The school/age line is hidden for teams — assert no "岁" appears.
    expect(screen.queryByText(/岁/)).not.toBeInTheDocument();
  });
});

describe('DisplayStageRankingView — caps at 20 rows', () => {
  it('renders at most 20 entities (podium 3 + 17 rest)', () => {
    const stages = [mkStage('s1', 1, 'RUNNING')];
    const rows = [];
    for (let i = 1; i <= 30; i++) {
      rows.push(mkRow('s1', `p${i}`, `Player${i}`, i, 200 - i));
    }
    renderView({ data: makeSnapshot(stages, rows) });
    // Podium (1-3) + rest (4-20) = 20 rows rendered.
    expect(screen.getByText('Player1')).toBeInTheDocument();
    expect(screen.getByText('Player20')).toBeInTheDocument();
    // Players 21+ must NOT be rendered — they would be unreadable from the
    // back of the room.
    expect(screen.queryByText('Player21')).not.toBeInTheDocument();
    expect(screen.queryByText('Player30')).not.toBeInTheDocument();
  });
});

describe('DisplayStageRankingView — presentational contract', () => {
  it('does not crash with the minimum required props (data only)', () => {
    // The parent may omit lastUpdated / pollIntervalSeconds / socketConnected.
    // The view must still render — they are optional.
    render(
      <DisplayStageRankingView
        data={makeSnapshot([mkStage('s1', 1, 'RUNNING')], [mkRow('s1', 'p1', 'Alice', 1, 150)])}
      />,
    );
    expect(screen.getByText('Spring Cup')).toBeInTheDocument();
  });

  it('falls back to a truncated entityId when entityName is missing', () => {
    // Edge case: a final_rankings row written before the server-side join
    // was added. The view must not crash — it shows "ID <uuid-prefix>".
    const stages = [mkStage('s1', 1, 'RUNNING')];
    const fr = [
      mkRow('s1', 'abcd1234-5678', null, 1, 100, { entityName: null }),
    ];
    renderView({ data: makeSnapshot(stages, fr) });
    expect(screen.getByText('ID abcd1234')).toBeInTheDocument();
  });
});
