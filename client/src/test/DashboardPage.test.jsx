// Unit tests for DashboardPage (Day-3 task 3.6).
//
// The overview page calls api.listCompetitions() and displays 4 stat cards
// (total / in progress / upcoming / finished) that act as clickable filters,
// plus a sorted competition list below.
//
// We verify:
//   - loading state
//   - counts per status bucket
//   - full competition list (no cap)
//   - empty state
//   - card-click filtering and toggle-off

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import DashboardPage from '../pages/DashboardPage';
import { api } from '../api';

vi.mock('../api', () => ({
  api: { listCompetitions: vi.fn() },
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

// 6 competitions with distinct counts per bucket, using the real backend
// statuses (DRAFT, PUBLISHED, RUNNING, PAUSED, FINISHED):
//   total = 6, in progress = 2 (RUNNING + PAUSED),
//   upcoming = 3 (DRAFT + 2×PUBLISHED — wait, let me recount):
//     DRAFT: B, C  → 2
//     PUBLISHED: D → 1
//     so upcoming = 3 ✓
//   finished = 1 (E).
// All distinct so getByText('N') won't collide.
const SAMPLE = [
  { id: 1, name: 'A', status: 'RUNNING', created_at: '2026-01-06T0:00:00Z' },
  { id: 2, name: 'B', status: 'DRAFT', created_at: '2026-01-05T00:00:00Z' },
  { id: 3, name: 'C', status: 'DRAFT', created_at: '2026-01-04T00:00:00Z' },
  { id: 4, name: 'D', status: 'PUBLISHED', created_at: '2026-01-03T00:00:00Z' },
  { id: 5, name: 'E', status: 'FINISHED', created_at: '2026-01-02T00:00:00Z' },
  { id: 6, name: 'F', status: 'PAUSED', created_at: '2026-01-01T00:00:00Z' },
];

describe('DashboardPage', () => {
  it('shows the loading text while fetching', () => {
    api.listCompetitions.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();
    expect(screen.queryByText(/loading|加载/i)).not.toBeNull();
  });

  it('counts competitions by status once loaded', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: SAMPLE });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('6')).toBeInTheDocument(); // total
    });
    expect(screen.getByText('2')).toBeInTheDocument(); // in progress (RUNNING + PAUSED)
    expect(screen.getByText('3')).toBeInTheDocument(); // upcoming (DRAFT + PUBLISHED)
    expect(screen.getByText('1')).toBeInTheDocument(); // finished
  });

  it('lists all competitions (no cap)', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: SAMPLE });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('A')).toBeInTheDocument();
    });
    // All 6 are rendered — no top-5 cap.
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getByText('E')).toBeInTheDocument();
    expect(screen.getByText('F')).toBeInTheDocument();
  });

  it('shows the empty state when there are no competitions', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: [] });
    renderPage();
    await waitFor(() => {
      const link = screen.getByRole('link', { href: '/dashboard/competitions' });
      expect(link).toBeInTheDocument();
    });
  });

  // Clicking the "in progress" card filters the list to only RUNNING + PAUSED
  // competitions (A and F). The count on the card stays the same.
  it('filters the list when a stat card is clicked', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: SAMPLE });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('A')).toBeInTheDocument();
    });

    // Click the "in progress" card (displays the number 2).
    // Cards are <button> elements; find the one whose text includes "2".
    const buttons = screen.getAllByRole('button');
    const inProgressBtn = buttons.find(btn => btn.textContent.includes('2'));
    expect(inProgressBtn).toBeDefined();
    fireEvent.click(inProgressBtn);

    // After filtering: A (RUNNING) and F (PAUSED) remain;
    // B, C (DRAFT), D (PUBLISHED), E (FINISHED) are hidden.
    await waitFor(() => {
      expect(screen.queryByText('B')).toBeNull();
    });
    expect(screen.queryByText('C')).toBeNull();
    expect(screen.queryByText('D')).toBeNull();
    expect(screen.queryByText('E')).toBeNull();
    // A and F still visible.
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('F')).toBeInTheDocument();
  });

  // Clicking the same card again resets the filter — all competitions return.
  it('toggles the filter off when the same card is clicked again', async () => {
    api.listCompetitions.mockResolvedValue({ code: 200, data: SAMPLE });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('A')).toBeInTheDocument();
    });

    const buttons = screen.getAllByRole('button');
    const inProgressBtn = buttons.find(btn => btn.textContent.includes('2'));
    // First click: filter ON.
    fireEvent.click(inProgressBtn);
    await waitFor(() => {
      expect(screen.queryByText('B')).toBeNull();
    });

    // Second click: filter OFF — all competitions come back.
    fireEvent.click(inProgressBtn);
    await waitFor(() => {
      expect(screen.getByText('B')).toBeInTheDocument();
    });
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getByText('E')).toBeInTheDocument();
  });
});
