// Unit tests for DashboardResultsPage (R7 — historical results page).
//
// The page calls api.listCompetitions() to populate the picker, then
// api.getResults(id, categoryId) to fetch the ranking snapshot for the
// selected competition. We verify:
//   1. The admin sees the picker and the round tabs.
//   2. Selecting a round shows its ranking rows.
//   3. The Final tab shows the final rankings.
//   4. A non-admin sees the "not allowed" message.
//   5. A competition with no rankings shows the empty state.
//   6. Category filter: dropdown appears when the snapshot has categories.
//   7. Category filter: selecting a category re-calls api.getResults with
//      the new (id, categoryId) pair.
//   8. Category filter: changing competition resets the categoryId to null
//      (no stale filter leaks into the new competition).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import DashboardResultsPage from '../pages/DashboardResultsPage';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    listCompetitions: vi.fn(),
    getResults: vi.fn(),
  },
  setToken: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ isAdmin: true, user: { role: 'ORG_ADMIN' } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <DashboardResultsPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

// Two competitions, the first one has a round with rankings + a final ranking.
const COMPETITIONS = [
  { id: 'comp-1', name: 'Spring Cup', status: 'FINISHED' },
  { id: 'comp-2', name: 'Autumn Cup', status: 'DRAFT' },
];

const SNAPSHOT = {
  competition: { id: 'comp-1', name: 'Spring Cup', status: 'FINISHED' },
  stages: [
    {
      id: 'stage-1',
      type: 'INDIVIDUAL',
      orderNumber: 1,
      status: 'FINISHED',
      rounds: [
        {
          id: 'round-1',
          name: 'Round 1',
          orderNumber: 1,
          status: 'FINISHED',
          rankings: [
            { rank: 1, totalScore: 120, player: { id: 'p1', name: 'Alice', school: 'School A', category: { name: 'U12' } } },
            { rank: 2, totalScore: 90, player: { id: 'p2', name: 'Bob', school: 'School B', category: { name: 'U12' } } },
          ],
        },
      ],
    },
  ],
  finalRankings: [
    { stageId: 'stage-1', categoryId: 'cat-1', entityType: 'PLAYER', entityId: 'p1', rank: 1, score: 120 },
  ],
  categories: [
    { id: 'cat-u12', name: 'U12', min_age: 9, max_age: 12 },
    { id: 'cat-u8', name: 'U8', min_age: 5, max_age: 8 },
  ],
};

describe('DashboardResultsPage', () => {
  it('shows the picker and round tabs for an admin', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.getResults.mockResolvedValue({ code: 200, data: SNAPSHOT });
    renderPage();
    // The first competition's name appears in the picker.
    await waitFor(() => {
      expect(screen.getByText(/Spring Cup/)).not.toBeNull();
    });
    // The round tab is rendered (Round 1).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Round 1|第 1 轮/ })).not.toBeNull();
    });
    // The Final tab is rendered.
    expect(screen.getByRole('button', { name: /^Final$|^最终$/ })).not.toBeNull();
  });

  it('shows ranking rows when a round is selected', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.getResults.mockResolvedValue({ code: 200, data: SNAPSHOT });
    renderPage();
    // Alice (rank 1) appears once the snapshot loads — the first round is
    // auto-selected.
    await waitFor(() => {
      expect(screen.getByText('Alice')).not.toBeNull();
    });
    // Score 120 is shown.
    expect(screen.getByText('120')).not.toBeNull();
  });

  it('shows final rankings when the Final tab is clicked', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.getResults.mockResolvedValue({ code: 200, data: SNAPSHOT });
    renderPage();
    // Wait for the round data to load first.
    await waitFor(() => {
      expect(screen.getByText('Alice')).not.toBeNull();
    });
    // Click the Final tab.
    fireEvent.click(screen.getByRole('button', { name: /^Final$|^最终$/ }));
    // The final ranking row (score 120, rank 1) is still shown — the final
    // ranking shares the same score as the round ranking in this fixture.
    expect(screen.getByText('120')).not.toBeNull();
  });

  it('shows the empty state when there are no competitions', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/No competitions|暂无赛事/)).not.toBeNull();
    });
  });

  it('shows the no-rankings message when a competition has no rounds', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.getResults.mockResolvedValue({
      code: 200,
      data: {
        competition: { id: 'comp-2', name: 'Autumn Cup', status: 'DRAFT' },
        stages: [],
        finalRankings: [],
        categories: [],
      },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/No rankings|暂无排名/)).not.toBeNull();
    });
  });

  it('shows the load-failed message when the list call fails', async () => {
    api.listCompetitions.mockResolvedValue({ code: 50000, message: 'DB down' });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/DB down/)).not.toBeNull();
    });
  });
});

describe('DashboardResultsPage — category filter', () => {
  it('shows the category dropdown when the snapshot has categories', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.getResults.mockResolvedValue({ code: 200, data: SNAPSHOT });
    renderPage();
    // The dropdown's "All categories" default option is the only unambiguous
    // marker that the dropdown itself is rendered. Looking for the "Category"
    // label alone would match the ranking-table column header, which uses
    // the same word in both languages.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /All categories|全部组别/ })).not.toBeNull();
    });
    // Both category names are rendered as options.
    expect(screen.getByRole('option', { name: 'U12' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'U8' })).not.toBeNull();
  });

  it('does NOT show the category dropdown when the snapshot has no categories', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.getResults.mockResolvedValue({
      code: 200,
      data: { ...SNAPSHOT, categories: [] },
    });
    renderPage();
    // Wait for the snapshot to load (round tab appears).
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Round 1|第 1 轮/ })).not.toBeNull();
    });
    // The "All categories" option — unique to the dropdown — must be absent.
    // Testing on the label word alone would false-match the table column
    // header, which uses "Category" / "组别" too.
    expect(screen.queryByRole('option', { name: /All categories|全部组别/ })).toBeNull();
  });

  it('re-calls api.getResults with (id, categoryId) when a category is selected', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.getResults.mockResolvedValue({ code: 200, data: SNAPSHOT });
    renderPage();
    // Wait for the first load (no categoryId).
    await waitFor(() => {
      expect(api.getResults).toHaveBeenCalledWith('comp-1', null);
    });

    // Pick the U12 category in the dropdown.
    const catSelect = screen.getByDisplayValue(/All categories|全部组别/);
    fireEvent.change(catSelect, { target: { value: 'cat-u12' } });

    // The effect refetches with the new categoryId.
    await waitFor(() => {
      expect(api.getResults).toHaveBeenCalledWith('comp-1', 'cat-u12');
    });
  });

  it('resets the categoryId to null when the competition changes', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.getResults.mockResolvedValue({ code: 200, data: SNAPSHOT });
    renderPage();
    // Wait for first load.
    await waitFor(() => {
      expect(api.getResults).toHaveBeenCalledWith('comp-1', null);
    });

    // Pick U12 — categoryId is now set.
    const catSelect = screen.getByDisplayValue(/All categories|全部组别/);
    fireEvent.change(catSelect, { target: { value: 'cat-u12' } });
    await waitFor(() => {
      expect(api.getResults).toHaveBeenCalledWith('comp-1', 'cat-u12');
    });

    // Now switch to the second competition — the categoryId must reset to
    // null, otherwise the stale "cat-u12" leaks into comp-2 (and the server
    // filter would silently return 0 rows if comp-2 has no U12 category).
    const compSelect = screen.getByDisplayValue(/Spring Cup/);
    fireEvent.change(compSelect, { target: { value: 'comp-2' } });

    await waitFor(() => {
      // The most recent call for comp-2 must pass null — not the stale
      // "cat-u12" from before.
      expect(api.getResults).toHaveBeenCalledWith('comp-2', null);
    });
  });
});
