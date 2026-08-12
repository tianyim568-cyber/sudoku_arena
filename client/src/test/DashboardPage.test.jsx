// Unit tests for DashboardPage (Day-3 task 3.6).
//
// The overview page calls api.listTournaments() and displays 4 stat cards:
// total / in progress / upcoming / finished, plus a top-5 recent list.
// We verify the counts are correct for a known set of tournaments.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import DashboardPage from '../pages/DashboardPage';
import { api } from '../api';

vi.mock('../api', () => ({
  api: { listTournaments: vi.fn() },
  setToken: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <DashboardPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

// 6 tournaments with distinct counts per bucket:
//   total = 6, in progress = 2 (IN_PROGRESS + PAUSED),
//   upcoming = 3 (PENDING), finished = 1.
// Distinct numbers matter because the page renders them as bare text nodes,
// and getByText('2') would otherwise match multiple elements.
const SAMPLE = [
  { id: 1, name: 'A', status: 'IN_PROGRESS' },
  { id: 2, name: 'B', status: 'PENDING' },
  { id: 3, name: 'C', status: 'PENDING' },
  { id: 4, name: 'D', status: 'PENDING' },
  { id: 5, name: 'E', status: 'FINISHED' },
  { id: 6, name: 'F', status: 'PAUSED' },
];

describe('DashboardPage', () => {
  it('shows the loading text while fetching', () => {
    api.listTournaments.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();
    // The page renders the i18n key dashboard.loading while loading is true.
    // Both dictionaries have it; just assert something loading-like is present.
    expect(screen.queryByText(/loading|加载/i)).not.toBeNull();
  });

  it('counts tournaments by status once loaded', async () => {
    api.listTournaments.mockResolvedValue({ code: 200, data: SAMPLE });
    renderPage();
    // total = 6, in progress = IN_PROGRESS + PAUSED = 2,
    // upcoming = PENDING = 3, finished = 1. All distinct.
    await waitFor(() => {
      expect(screen.getByText('6')).toBeInTheDocument(); // total
    });
    expect(screen.getByText('2')).toBeInTheDocument(); // in progress
    expect(screen.getByText('3')).toBeInTheDocument(); // upcoming
    expect(screen.getByText('1')).toBeInTheDocument(); // finished
  });

  it('lists up to 5 recent tournaments', async () => {
    api.listTournaments.mockResolvedValue({ code: 200, data: SAMPLE });
    renderPage();
    // The list caps at 5 even though SAMPLE has 6. We assert the first 5
    // names are present.
    await waitFor(() => {
      expect(screen.getByText('A')).toBeInTheDocument();
    });
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getByText('E')).toBeInTheDocument();
  });

  it('shows the empty state when there are no tournaments', async () => {
    api.listTournaments.mockResolvedValue({ code: 200, data: [] });
    renderPage();
    // The empty state renders the dashboard.noCompetitions text + a link to
    // /dashboard/competitions. We assert the link is present.
    await waitFor(() => {
      const link = screen.getByRole('link', { href: '/dashboard/competitions' });
      expect(link).toBeInTheDocument();
    });
  });
});
