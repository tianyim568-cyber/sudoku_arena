// Unit tests for RankingView — the extracted ranking view of the big-screen
// display.
//
// The goal of this file (per the task prompt): pin that the extraction from
// DisplayPage did NOT change what gets rendered. Every element that was
// previously rendered inline by DisplayPage must still be rendered by
// RankingView — same labels, same structure, same data flow.
//
// We test RankingView in isolation by feeding it a fixture snapshot. We do
// NOT test DisplayPage here; its only job after the extraction is to fetch
// and delegate, and the fetch logic is unchanged from before.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';
import RankingView from '../components/RankingView';

const SNAPSHOT = {
  competition: { id: 'c1', name: 'Spring Cup', status: 'IN_PROGRESS' },
  categories: [
    { id: 'cat-1', name: 'U10', min_age: 7, max_age: 10 },
    { id: 'cat-2', name: 'U13', min_age: 11, max_age: 13 },
  ],
  stages: [
    {
      id: 's1',
      type: 'TEAM',
      orderNumber: 1,
      status: 'IN_PROGRESS',
      rounds: [
        {
          id: 'r1',
          name: 'Round 1',
          orderNumber: 1,
          status: 'IN_PROGRESS',
          rankings: [
            {
              rank: 1,
              totalScore: 120,
              player: { id: 'p1', name: 'Alice', school: 'School A', age: 9, category: { id: 'cat-1', name: 'U10' } },
            },
            {
              rank: 2,
              totalScore: 95,
              player: { id: 'p2', name: 'Bob', school: 'School B', age: 10, category: { id: 'cat-1', name: 'U10' } },
            },
          ],
        },
      ],
    },
  ],
  finalRankings: [
    { stageId: 's1', categoryId: null, entityType: 'PLAYER', entityId: 'p1', rank: 1, score: 120 },
  ],
  generatedAt: '2026-08-15T10:00:00.000Z',
};

function renderView(props = {}) {
  const onSelectCategory = vi.fn();
  render(
    <LanguageProvider>
      <RankingView
        data={SNAPSHOT}
        selectedCategoryId={null}
        onSelectCategory={onSelectCategory}
        {...props}
      />
    </LanguageProvider>
  );
  return { onSelectCategory };
}

describe('RankingView — regression: everything that was in DisplayPage still renders', () => {
  it('shows the competition name and status badge', () => {
    renderView();
    expect(screen.getByText('Spring Cup')).toBeInTheDocument();
    // '进行中' is the IN_PROGRESS label, and it legitimately appears more than
    // once (the competition badge and the stage/round rows share the wording).
    // Assert it is present, not that it is unique.
    expect(screen.getAllByText('进行中').length).toBeGreaterThan(0);
  });

  it('shows the "all categories" tab plus one tab per category', () => {
    renderView();
    // Target the TABS specifically. A category name also appears on every
    // player row, so a plain text query matches several nodes — and would
    // still pass if the tabs disappeared entirely.
    expect(screen.getByRole('button', { name: /全部组别/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /U10/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /U13/ })).toBeInTheDocument();
  });

  it('shows the age range next to the category name', () => {
    renderView();
    expect(screen.getByText(/\(7-10岁\)/)).toBeInTheDocument();
  });

  it('renders the stage header with its order number and type', () => {
    renderView();
    expect(screen.getByText(/阶段 1/)).toBeInTheDocument();
    expect(screen.getByText(/\(TEAM\)/)).toBeInTheDocument();
  });

  it('renders each round name', () => {
    renderView();
    expect(screen.getByText('Round 1')).toBeInTheDocument();
  });

  it('renders each ranked player with name, school, age, category, and score', () => {
    renderView();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('School A')).toBeInTheDocument();
    expect(screen.getByText('9岁')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('95')).toBeInTheDocument();
    // Alice's 120 shows in the round ranking AND again in the final ranking —
    // two nodes on purpose.
    expect(screen.getAllByText('120')).toHaveLength(2);
  });

  it('renders the final rankings section', () => {
    renderView();
    expect(screen.getByText('最终排名')).toBeInTheDocument();
  });

  it('renders the footer with the refresh cadence', () => {
    renderView({ pollIntervalSeconds: 10 });
    expect(screen.getByText(/每 10 秒自动刷新/)).toBeInTheDocument();
  });

  it('shows the lastUpdated timestamp in the header when provided', () => {
    const date = new Date('2026-08-15T10:30:00.000Z');
    renderView({ lastUpdated: date });
    // We don't pin the exact string (locale-dependent), just that the label
    // prefix is present.
    expect(screen.getByText(/更新于/)).toBeInTheDocument();
  });
});

describe('RankingView — category switching', () => {
  it('calls onSelectCategory with the category id when a tab is clicked', () => {
    const { onSelectCategory } = renderView();
    fireEvent.click(screen.getByRole('button', { name: /U10/ }));
    expect(onSelectCategory).toHaveBeenCalledWith('cat-1');
  });

  it('calls onSelectCategory with null when "all" is clicked', () => {
    const { onSelectCategory } = renderView({ selectedCategoryId: 'cat-1' });
    fireEvent.click(screen.getByText('全部组别'));
    expect(onSelectCategory).toHaveBeenCalledWith(null);
  });
});

describe('RankingView — edge cases', () => {
  it('renders the empty-state message when there are no stages', () => {
    renderView({
      data: { ...SNAPSHOT, stages: [] },
    });
    expect(screen.getByText('暂无比赛阶段数据')).toBeInTheDocument();
  });

  it('renders the empty-state message when a round has no rankings', () => {
    renderView({
      data: {
        ...SNAPSHOT,
        stages: [
          {
            ...SNAPSHOT.stages[0],
            rounds: [{ ...SNAPSHOT.stages[0].rounds[0], rankings: [] }],
          },
        ],
      },
    });
    expect(screen.getByText('暂无排名数据')).toBeInTheDocument();
  });

  it('does not render the final rankings section when there are none', () => {
    renderView({
      data: { ...SNAPSHOT, finalRankings: [] },
    });
    expect(screen.queryByText('最终排名')).toBeNull();
  });
});
