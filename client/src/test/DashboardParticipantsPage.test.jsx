// Unit tests for DashboardParticipantsPage — the global read-only view
// that replaces the ComingSoonPage at /dashboard/participants (F32).
//
// The page hits GET /api/participants (mocked here as api.listAllParticipants).
// The tenant filter (organization_id) lives on the server side — we assert
// on the client behaviour: filters are wired, refetching happens on
// change, debounced search actually debounces, and the two empty states
// (org-empty vs filter-empty) surface the right copy.
//
// Category dropdown: derived client-side from the participants actually
// loaded. Hidden when no participant carries a category — no empty
// dropdown on category-less competitions.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import DashboardParticipantsPage from '../pages/DashboardParticipantsPage';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    listCompetitions: vi.fn(),
    listAllParticipants: vi.fn(),
  },
  setToken: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <DashboardParticipantsPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

const COMPETITIONS = [
  { id: 'comp-1', name: 'Spring Cup', status: 'FINISHED' },
  { id: 'comp-2', name: 'Autumn Cup', status: 'DRAFT' },
];

const ROWS = [
  {
    id: 'p1', name: 'Alice', school: 'School A', age: 12,
    categoryId: 'cat-u12', categoryName: 'U12',
    competitionId: 'comp-1', competitionName: 'Spring Cup', competitionStatus: 'FINISHED',
    createdAt: '2026-08-01T00:00:00Z',
  },
  {
    id: 'p2', name: 'Bob', school: 'School B', age: 8,
    categoryId: 'cat-u8', categoryName: 'U8',
    competitionId: 'comp-1', competitionName: 'Spring Cup', competitionStatus: 'FINISHED',
    createdAt: '2026-08-02T00:00:00Z',
  },
  {
    id: 'p3', name: 'Chao', school: 'School C', age: null,
    categoryId: null, categoryName: null,
    competitionId: 'comp-2', competitionName: 'Autumn Cup', competitionStatus: 'DRAFT',
    createdAt: '2026-08-03T00:00:00Z',
  },
];

describe('DashboardParticipantsPage', () => {
  it('renders the rows once loaded, with count', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.listAllParticipants.mockResolvedValue({ code: 200, data: ROWS });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Chao')).toBeInTheDocument();
    });
    // Count message must reflect the number of rows.
    expect(screen.getByText((_, el) => el?.textContent === '共 3 名选手' || el?.textContent === '3 participants')).toBeInTheDocument();
  });

  it('links each row to its competition detail page', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.listAllParticipants.mockResolvedValue({ code: 200, data: ROWS });
    renderPage();
    await screen.findByText('Alice');
    // Two participants belong to comp-1 → two links to /competitions/comp-1.
    // getAllByRole('link') scoped to the competition name to be safe.
    const links = screen.getAllByRole('link', { name: 'Spring Cup' });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].getAttribute('href')).toBe('/competitions/comp-1');
  });

  it('shows the category dropdown only when participants carry categories', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.listAllParticipants.mockResolvedValue({ code: 200, data: ROWS });
    renderPage();
    // Alice + Bob both have categories → dropdown must appear with U12/U8.
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /All categories|全部组别/ })).toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: 'U12' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'U8' })).toBeInTheDocument();
  });

  it('does NOT show the category dropdown when no participant carries one', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.listAllParticipants.mockResolvedValue({
      code: 200,
      data: [ROWS[2]], // Chao only — no categoryId
    });
    renderPage();
    await screen.findByText('Chao');
    // "All categories" option is the unique dropdown marker (the column
    // header uses the same word). Absence = no dropdown.
    expect(screen.queryByRole('option', { name: /All categories|全部组别/ })).toBeNull();
  });

  it('refetches with competitionId when the competition filter changes', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.listAllParticipants.mockResolvedValue({ code: 200, data: ROWS });
    renderPage();
    await waitFor(() => {
      expect(api.listAllParticipants).toHaveBeenCalledWith({});
    });
    // Pick Spring Cup in the competition dropdown.
    const compSelect = screen.getByDisplayValue(/All competitions|全部赛事/);
    fireEvent.change(compSelect, { target: { value: 'comp-1' } });
    await waitFor(() => {
      expect(api.listAllParticipants).toHaveBeenCalledWith({ competitionId: 'comp-1' });
    });
  });

  it('refetches with categoryId when the category filter changes', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.listAllParticipants.mockResolvedValue({ code: 200, data: ROWS });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'U12' })).toBeInTheDocument();
    });
    const catSelect = screen.getByDisplayValue(/All categories|全部组别/);
    fireEvent.change(catSelect, { target: { value: 'cat-u12' } });
    await waitFor(() => {
      expect(api.listAllParticipants).toHaveBeenCalledWith({ categoryId: 'cat-u12' });
    });
  });

  it('debounces the search input by 300ms', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.listAllParticipants.mockResolvedValue({ code: 200, data: ROWS });
    renderPage();

    // Initial fetch happens without a search term.
    await waitFor(() => {
      expect(api.listAllParticipants).toHaveBeenCalledWith({});
    });

    const searchInput = screen.getByPlaceholderText(/Search by name|按姓名或学校搜索/);

    // Type "Ma" then "Mar" — should not fire per keystroke.
    fireEvent.change(searchInput, { target: { value: 'Ma' } });
    fireEvent.change(searchInput, { target: { value: 'Mar' } });
    fireEvent.change(searchInput, { target: { value: 'Marie' } });

    // Before 300ms elapse, no new call.
    act(() => { vi.advanceTimersByTime(200); });
    // Still just the initial {} call.
    expect(api.listAllParticipants.mock.calls.filter(c => c[0]?.search).length).toBe(0);

    // After the full debounce window, refetch with the final term.
    act(() => { vi.advanceTimersByTime(200); });
    await waitFor(() => {
      expect(api.listAllParticipants).toHaveBeenCalledWith({ search: 'Marie' });
    });

    vi.useRealTimers();
  });

  it('shows the empty-org copy when the org has no participants and no filter is active', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.listAllParticipants.mockResolvedValue({ code: 200, data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/No participants yet|暂无选手。请前往/)).toBeInTheDocument();
    });
  });

  it('shows the filter-empty copy after a filter narrows to zero rows', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    // First load returns rows, second load (after filter) returns nothing.
    api.listAllParticipants
      .mockResolvedValueOnce({ code: 200, data: ROWS })
      .mockResolvedValueOnce({ code: 200, data: [] });
    renderPage();
    await screen.findByText('Alice');
    const compSelect = screen.getByDisplayValue(/All competitions|全部赛事/);
    fireEvent.change(compSelect, { target: { value: 'comp-2' } });
    await waitFor(() => {
      expect(screen.getByText(/No participants match|没有符合筛选条件/)).toBeInTheDocument();
    });
    // Must NOT show the empty-org copy — we know the org has data.
    expect(screen.queryByText(/No participants yet|请前往某个赛事/)).toBeNull();
  });

  it('shows the load-failed message on server error', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
    api.listAllParticipants.mockResolvedValue({ code: 50000, message: 'DB down' });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('DB down')).toBeInTheDocument();
    });
  });
});
