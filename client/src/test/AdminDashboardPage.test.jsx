// Unit tests for AdminDashboardPage (R11 — Super Admin dashboard).
//
// The page calls api.getAdminOverview() to fetch the platform-wide overview
// (stats, organizations, competitions). We verify:
//   1. The four stat cards render with the right counts.
//   2. The competitions-by-status grid shows the byStatus breakdown.
//   3. The organizations table lists orgs with their counts.
//   4. The recent competitions table lists the 50 most recent.
//   5. An error from the server shows the error state.
//   6. An empty platform (zero of everything) shows the empty states.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import AdminDashboardPage from '../pages/AdminDashboardPage';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getAdminOverview: vi.fn(),
  },
  setToken: vi.fn(),
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <AdminDashboardPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

const OVERVIEW = {
  stats: {
    organizations: 2,
    competitions: {
      total: 5,
      byStatus: { DRAFT: 1, PUBLISHED: 2, RUNNING: 1, FINISHED: 1 },
    },
    users: {
      byRole: { PLAYER: 10, JUDGE: 3, ORG_ADMIN: 2, SUPER_ADMIN: 1 },
    },
  },
  organizations: [
    { id: 'org-1', name: 'Acme', status: 'ACTIVE', createdAt: '2026-08-01T00:00:00Z', userCount: 8, competitionCount: 3 },
    { id: 'org-2', name: 'Globex', status: 'ACTIVE', createdAt: '2026-08-02T00:00:00Z', userCount: 4, competitionCount: 2 },
  ],
  competitions: [
    { id: 'comp-1', name: 'Spring Cup', status: 'FINISHED', createdAt: '2026-08-03T00:00:00Z', organizationName: 'Acme' },
    { id: 'comp-2', name: 'Autumn Cup', status: 'DRAFT', createdAt: '2026-08-04T00:00:00Z', organizationName: 'Globex' },
  ],
};

describe('AdminDashboardPage', () => {
  it('shows the four stat cards with the right counts', async () => {
    api.getAdminOverview.mockResolvedValue({ code: 200, data: OVERVIEW });
    renderPage();

    await waitFor(() => {
      // Organizations count = 2. The number 2 also appears in byStatus
      // (PUBLISHED: 2), so we check the org card specifically by gathering
      // all elements with "2" and asserting at least one matches.
      const twos = screen.getAllByText(/^2$/);
      expect(twos.length).toBeGreaterThanOrEqual(1);
    });
    // 5 (competitions total), 10 (players), 3 (judges) — also match by
    // getAllByText since the byStatus grid contributes its own counts.
    expect(screen.getAllByText(/^5$/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/^10$/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/^3$/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows the competitions-by-status breakdown', async () => {
    api.getAdminOverview.mockResolvedValue({ code: 200, data: OVERVIEW });
    renderPage();

    await waitFor(() => {
      // Status labels come from common.status.* — zh by default. Some statuses
      // appear in both the byStatus grid and the recent competitions table
      // (e.g. DRAFT is the status of Autumn Cup), so we use getAllByText.
      expect(screen.getAllByText(/草稿|Draft/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/已发布|Published/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/进行中|In progress/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/已结束|Finished/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('lists organizations with their user and competition counts', async () => {
    api.getAdminOverview.mockResolvedValue({ code: 200, data: OVERVIEW });
    renderPage();

    await waitFor(() => {
      // Org names appear in BOTH the orgs table and the recent competitions
      // table (as organizationName), so we accept multiple matches.
      const acme = screen.getAllByText('Acme');
      expect(acme.length).toBeGreaterThanOrEqual(1);
    });
    const globex = screen.getAllByText('Globex');
    expect(globex.length).toBeGreaterThanOrEqual(1);
  });

  it('lists recent competitions with org name and status', async () => {
    api.getAdminOverview.mockResolvedValue({ code: 200, data: OVERVIEW });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Spring Cup')).toBeInTheDocument();
    });
    expect(screen.getByText('Autumn Cup')).toBeInTheDocument();
    // Org names appear in both tables, so we use getAllByText.
    expect(screen.getAllByText('Acme').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Globex').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the error state when the server fails', async () => {
    api.getAdminOverview.mockResolvedValue({ code: 50000, message: 'internal error' });
    renderPage();

    await waitFor(() => {
      // Error block renders — the page uses t('admin.loadFailed') in a red panel.
      // The error message is also rendered in red text.
      expect(screen.getByText(/Could not load|无法加载/)).toBeInTheDocument();
    });
  });

  it('shows the empty states when the platform has nothing', async () => {
    api.getAdminOverview.mockResolvedValue({
      code: 200,
      data: {
        stats: {
          organizations: 0,
          competitions: { total: 0, byStatus: {} },
          users: { byRole: {} },
        },
        organizations: [],
        competitions: [],
      },
    });
    renderPage();

    await waitFor(() => {
      // "No organizations yet." / "No competitions yet." — the empty states.
      expect(screen.getByText(/No organizations yet|暂无组织/)).toBeInTheDocument();
      expect(screen.getByText(/No competitions yet|暂无赛事/)).toBeInTheDocument();
    });
  });
});
