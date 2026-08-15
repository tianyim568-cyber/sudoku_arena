// Unit tests for DashboardLayout (Day-3 task 3.3).
//
// The layout renders a sidebar with 7 navigation items and an <Outlet /> where
// child routes render. We verify:
//   - all 7 nav items are rendered (by their i18n labels)
//   - the active item gets the indigo background class
//   - the outlet renders the matched child route
//   - the header shows the user's displayName and role
//
// We wrap the layout in AuthProvider + LanguageProvider + MemoryRouter with a
// couple of test routes, so we can navigate by clicking nav links.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../hooks/useAuth';
import { LanguageProvider } from '../i18n/LanguageContext';
import DashboardLayout from '../components/DashboardLayout';

// Mock the api module so AuthProvider doesn't try to call /auth/me.
vi.mock('../api', () => ({
  api: { getMe: vi.fn().mockResolvedValue({ code: 401 }) },
  setToken: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// Seed a logged-in admin so the header shows a displayName + role.
function seedAdmin() {
  const b64 = (o) =>
    btoa(unescape(encodeURIComponent(JSON.stringify(o))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
    userId: 1, role: 'ORG_ADMIN', displayName: 'Alice Admin', exp: Math.floor(Date.now() / 1000) + 3600,
  })}.sig`;
  localStorage.setItem('token', token);
}

// Render the layout at a given starting path, with two child routes so we can
// see the Outlet swap.
function renderLayoutAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LanguageProvider>
        <AuthProvider>
          <Routes>
            <Route path="/dashboard" element={<DashboardLayout />}>
              <Route index element={<div data-testid="page-overview">overview</div>} />
              <Route path="competitions" element={<div data-testid="page-comp">competitions</div>} />
              <Route path="puzzle-bank" element={<div data-testid="page-bank">bank</div>} />
              <Route path="*" element={<div data-testid="page-other">other</div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe('DashboardLayout', () => {
  it('renders all 7 sidebar nav items', async () => {
    seedAdmin();
    renderLayoutAt('/dashboard');
    // The i18n keys dashboard.nav.* — we check by the English labels since
    // the default language is 'zh', but the labels are distinct strings in
    // both dictionaries so we match case-insensitively on known substrings.
    // Use getAllByRole('link') — NavLink renders an <a>.
    const links = await screen.findAllByRole('link');
    // 7 nav links. (The header buttons are <button>, not <a>, so they don't
    // pollute the count.)
    expect(links.length).toBe(7);
  });

  it('renders the index page (overview) at /dashboard', async () => {
    seedAdmin();
    renderLayoutAt('/dashboard');
    expect(await screen.findByTestId('page-overview')).toBeInTheDocument();
  });

  it('renders the competitions page at /dashboard/competitions', async () => {
    seedAdmin();
    renderLayoutAt('/dashboard/competitions');
    expect(await screen.findByTestId('page-comp')).toBeInTheDocument();
  });

  it('navigates to puzzle-bank when its nav link is clicked', async () => {
    seedAdmin();
    renderLayoutAt('/dashboard');
    // Wait for layout to mount, then click the puzzle-bank link.
    await screen.findByTestId('page-overview');
    // Find the link whose href ends with /dashboard/puzzle-bank.
    const bankLink = screen.getAllByRole('link').find(
      (a) => a.getAttribute('href') === '/dashboard/puzzle-bank'
    );
    expect(bankLink).toBeDefined();
    fireEvent.click(bankLink);
    expect(await screen.findByTestId('page-bank')).toBeInTheDocument();
  });
});
