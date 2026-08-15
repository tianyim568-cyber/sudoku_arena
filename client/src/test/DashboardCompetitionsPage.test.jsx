// Unit tests for DashboardCompetitionsPage (Day-3 task 3.5).
//
// Regression guard: multi-tenancy renamed the administrator role to
// ORG_ADMIN. The page used to compare `user.role === 'ADMIN'` directly, so
// after the migration the "+ New competition" and "Delete" controls silently
// disappeared for every real administrator. The page now reads `isAdmin`
// from the auth context, which accepts both role names.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import DashboardCompetitionsPage from '../pages/DashboardCompetitionsPage';
import { api } from '../api';
import { ADMIN_ROLES, useAuth } from '../hooks/useAuth';

vi.mock('../api', () => ({
  api: { listCompetitions: vi.fn(), createCompetition: vi.fn(), deleteCompetition: vi.fn() },
  setToken: vi.fn(),
}));

// Mock only useAuth; ADMIN_ROLES keeps its real value so the test breaks if
// the accepted role list ever stops covering ORG_ADMIN.
vi.mock('../hooks/useAuth', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useAuth: vi.fn() };
});

const COMPETITIONS = [
  { id: 1, name: 'Spring Cup', description: 'desc', status: 'PENDING' },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.listCompetitions.mockResolvedValue({ code: 200, data: COMPETITIONS });
});

function renderAs(role) {
  useAuth.mockReturnValue({
    user: { userId: 1, role },
    isAdmin: ADMIN_ROLES.includes(role),
  });
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <DashboardCompetitionsPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

// The create button is the control that went missing after the migration.
const createButton = () =>
  screen.queryAllByRole('button').find(b => /new competition|新建|新增/i.test(b.textContent));

describe('DashboardCompetitionsPage — administrator controls', () => {
  it('shows the create button for an ORG_ADMIN (the post-migration role)', async () => {
    renderAs('ORG_ADMIN');
    await waitFor(() => expect(screen.getByText('Spring Cup')).toBeInTheDocument());
    expect(createButton()).toBeDefined();
  });

  it('hides it for a legacy ADMIN account (role no longer recognized)', async () => {
    renderAs('ADMIN');
    await waitFor(() => expect(screen.getByText('Spring Cup')).toBeInTheDocument());
    expect(createButton()).toBeUndefined();
  });

  it('hides it from a PLAYER', async () => {
    renderAs('PLAYER');
    await waitFor(() => expect(screen.getByText('Spring Cup')).toBeInTheDocument());
    expect(createButton()).toBeUndefined();
  });

  it('lists the competitions returned by the API', async () => {
    renderAs('ORG_ADMIN');
    await waitFor(() => expect(screen.getByText('Spring Cup')).toBeInTheDocument());
    expect(api.listCompetitions).toHaveBeenCalledTimes(1);
  });
});

// Regression guard: the page used to test only `if (res.code === 200)` with no
// else branch, so any failed call rendered nothing at all — a dead endpoint was
// indistinguishable from a dead button. The failure reason must reach the
// screen. Assertions match the interpolated detail rather than the label, so
// they hold in either language.
describe('DashboardCompetitionsPage — failed requests are reported', () => {
  it('reports the reason when creation fails', async () => {
    api.createCompetition.mockResolvedValue({ code: 404, message: 'HTTP 404', data: null });
    renderAs('ORG_ADMIN');
    await waitFor(() => expect(screen.getByText('Spring Cup')).toBeInTheDocument());

    fireEvent.click(createButton());
    // The inputs carry only a placeholder, which is language-dependent — select
    // them structurally instead.
    fireEvent.change(document.querySelector('form input[type="text"]'), {
      target: { value: 'Autumn Cup' },
    });
    fireEvent.submit(document.querySelector('form'));

    expect(await screen.findByText(/HTTP 404/)).toBeInTheDocument();
  });

  it('reports the reason when the list cannot be loaded', async () => {
    api.listCompetitions.mockResolvedValue({ code: 404, message: 'HTTP 404', data: null });
    renderAs('ORG_ADMIN');

    expect(await screen.findByText(/HTTP 404/)).toBeInTheDocument();
  });
});
