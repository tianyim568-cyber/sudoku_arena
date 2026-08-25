// Unit tests for DisplayFinalRankingView — the big-screen view for the
// FINAL_RANKING display mode.
//
// The goal of this file: pin that the view renders the final podium
// correctly — medals for top 3, headlines (冠军/亚军/季军), entity names
// resolved by the server, and an honest empty state when no final rankings
// have been written yet.
//
// We test the view in isolation by feeding it a fixture snapshot. The view
// is presentational only — it receives the snapshot in props and touches no
// network — so no socket or fetch mock is needed.
//
// Shape of data.finalRankings (built by DisplayManager.getRankingSnapshot):
//   { stageId, categoryId, entityType, entityId, entityName, school, age,
//     rank, score }
// entityName is resolved by the server via a join on players or teams
// based on entityType. If the name is missing (edge case, or a row written
// before the join was added), the view falls back to a truncated entityId.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';
import DisplayFinalRankingView from '../components/DisplayFinalRankingView';

const COMPETITION = { id: 'c1', name: 'Spring Cup', status: 'FINISHED', displayMode: 'FINAL_RANKING' };

function makeSnapshot(finalRankings) {
  return {
    competition: COMPETITION,
    categories: [],
    stages: [],
    finalRankings,
    generatedAt: '2026-08-15T10:00:00.000Z',
  };
}

function renderView(props = {}) {
  return render(
    <LanguageProvider>
      <DisplayFinalRankingView
        data={props.data || makeSnapshot([])}
        lastUpdated={null}
        pollIntervalSeconds={10}
        socketConnected={false}
        {...props}
      />
    </LanguageProvider>
  );
}

const PODIUM = [
  {
    stageId: 's1', categoryId: null, entityType: 'PLAYER',
    entityId: 'p1', entityName: 'Alice', school: 'School A', age: 9,
    rank: 1, score: 150,
  },
  {
    stageId: 's1', categoryId: null, entityType: 'PLAYER',
    entityId: 'p2', entityName: 'Bob', school: 'School B', age: 10,
    rank: 2, score: 120,
  },
  {
    stageId: 's1', categoryId: null, entityType: 'PLAYER',
    entityId: 'p3', entityName: 'Cécile', school: 'School C', age: 11,
    rank: 3, score: 95,
  },
];

const REST = [
  {
    stageId: 's1', categoryId: null, entityType: 'PLAYER',
    entityId: 'p4', entityName: 'David', school: 'School D', age: 8,
    rank: 4, score: 80,
  },
  {
    stageId: 's1', categoryId: null, entityType: 'PLAYER',
    entityId: 'p5', entityName: 'Eva', school: 'School E', age: 9,
    rank: 5, score: 70,
  },
];

describe('DisplayFinalRankingView — header', () => {
  it('shows the competition name and "最终排名" headline', () => {
    renderView({ data: makeSnapshot(PODIUM) });
    expect(screen.getByText('Spring Cup')).toBeInTheDocument();
    expect(screen.getByText('最终排名')).toBeInTheDocument();
  });

  it('renders the footer with the page label', () => {
    renderView({ data: makeSnapshot(PODIUM) });
    expect(screen.getByText(/数独竞技场 — 最终排名/)).toBeInTheDocument();
  });

  it('shows the socket status when connected', () => {
    renderView({ data: makeSnapshot(PODIUM), socketConnected: true });
    expect(screen.getByText(/实时连接/)).toBeInTheDocument();
  });

  it('shows the poll interval when socket is down', () => {
    renderView({ data: makeSnapshot(PODIUM), socketConnected: false, pollIntervalSeconds: 10 });
    expect(screen.getByText(/每 10 秒自动刷新/)).toBeInTheDocument();
  });
});

describe('DisplayFinalRankingView — podium (top 3)', () => {
  it('renders each podium entity with its name', () => {
    renderView({ data: makeSnapshot(PODIUM) });
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Cécile')).toBeInTheDocument();
  });

  it('renders the school and age for each podium entity', () => {
    renderView({ data: makeSnapshot(PODIUM) });
    expect(screen.getByText('School A')).toBeInTheDocument();
    expect(screen.getByText('9岁')).toBeInTheDocument();
    expect(screen.getByText('School B')).toBeInTheDocument();
    expect(screen.getByText('10岁')).toBeInTheDocument();
  });

  it('renders the headlines 冠军 / 亚军 / 季军 for ranks 1, 2, 3', () => {
    renderView({ data: makeSnapshot(PODIUM) });
    expect(screen.getByText('冠军')).toBeInTheDocument();
    expect(screen.getByText('亚军')).toBeInTheDocument();
    expect(screen.getByText('季军')).toBeInTheDocument();
  });

  it('renders each podium score', () => {
    renderView({ data: makeSnapshot(PODIUM) });
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('95')).toBeInTheDocument();
  });

  it('renders the rank numbers 1, 2, 3 inside the medal badges', () => {
    const { container } = renderView({ data: makeSnapshot(PODIUM) });
    // The rank numbers appear inside the round badges — we assert by text
    // content, not by class, so a color tweak does not break the test.
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    // Sanity-check the medal CSS classes are applied — gold/silver/bronze.
    expect(container.querySelector('.bg-yellow-500')).toBeTruthy();
    expect(container.querySelector('.bg-gray-300')).toBeTruthy();
    expect(container.querySelector('.bg-amber-700')).toBeTruthy();
  });
});

describe('DisplayFinalRankingView — ranks 4+', () => {
  it('renders each non-podium entity with its name', () => {
    renderView({ data: makeSnapshot(REST) });
    expect(screen.getByText('David')).toBeInTheDocument();
    expect(screen.getByText('Eva')).toBeInTheDocument();
  });

  it('does NOT render a podium headline for ranks 4+', () => {
    renderView({ data: makeSnapshot(REST) });
    expect(screen.queryByText('冠军')).not.toBeInTheDocument();
    expect(screen.queryByText('亚军')).not.toBeInTheDocument();
    expect(screen.queryByText('季军')).not.toBeInTheDocument();
  });

  it('renders each non-podium score', () => {
    renderView({ data: makeSnapshot(REST) });
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('70')).toBeInTheDocument();
  });
});

describe('DisplayFinalRankingView — teams', () => {
  it('renders a team entity with the 队伍 label', () => {
    const teamSnapshot = makeSnapshot([
      {
        stageId: 's1', categoryId: null, entityType: 'TEAM',
        entityId: 't1', entityName: 'Team Alpha', school: null, age: null,
        rank: 1, score: 200,
      },
    ]);
    renderView({ data: teamSnapshot });
    expect(screen.getByText('Team Alpha')).toBeInTheDocument();
    expect(screen.getByText('队伍')).toBeInTheDocument();
  });
});

describe('DisplayFinalRankingView — empty and fallback states', () => {
  it('shows an honest empty state when finalRankings is empty', () => {
    renderView({ data: makeSnapshot([]) });
    expect(screen.getByText('最终排名尚未生成')).toBeInTheDocument();
    expect(screen.getByText('比赛结束后，最终排名将显示在此处')).toBeInTheDocument();
  });

  it('shows an honest empty state when finalRankings is absent', () => {
    // Defensive: the server always sends the field, but if it ever forgets
    // the view must not crash — it must show the empty state.
    const noField = { competition: COMPETITION, categories: [], stages: [] };
    renderView({ data: noField });
    expect(screen.getByText('最终排名尚未生成')).toBeInTheDocument();
  });

  it('falls back to a truncated entityId when entityName is missing', () => {
    // Edge case: a final_rankings row written before the server-side join
    // was added. The view must not crash — it shows "ID <uuid-prefix>".
    const fallbackSnapshot = makeSnapshot([
      {
        stageId: 's1', categoryId: null, entityType: 'PLAYER',
        entityId: 'abcd1234-5678', entityName: null, school: null, age: null,
        rank: 1, score: 100,
      },
    ]);
    renderView({ data: fallbackSnapshot });
    expect(screen.getByText('ID abcd1234')).toBeInTheDocument();
  });
});

describe('DisplayFinalRankingView — caps at 20 rows', () => {
  it('renders at most 20 entities (podium 3 + 17 rest)', () => {
    const rows = [];
    for (let i = 1; i <= 30; i++) {
      rows.push({
        stageId: 's1', categoryId: null, entityType: 'PLAYER',
        entityId: `p${i}`, entityName: `Player${i}`, school: null, age: null,
        rank: i, score: 200 - i,
      });
    }
    renderView({ data: makeSnapshot(rows) });
    // Podium (1-3) + rest (4-20) = 20 rows rendered.
    expect(screen.getByText('Player1')).toBeInTheDocument();
    expect(screen.getByText('Player20')).toBeInTheDocument();
    // Players 21+ must NOT be rendered — they would be unreadable from the
    // back of the room.
    expect(screen.queryByText('Player21')).not.toBeInTheDocument();
    expect(screen.queryByText('Player30')).not.toBeInTheDocument();
  });
});

describe('DisplayFinalRankingView — presentational contract', () => {
  it('does not crash with the minimum required props (data only)', () => {
    // The parent may omit lastUpdated / pollIntervalSeconds / socketConnected.
    // The view must still render — they are optional.
    render(
      <LanguageProvider>
        <DisplayFinalRankingView data={makeSnapshot(PODIUM)} />
      </LanguageProvider>
    );
    expect(screen.getByText('Spring Cup')).toBeInTheDocument();
  });
});
