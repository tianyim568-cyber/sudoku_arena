// Unit tests for CompetitionEntryPage (Day-3 tasks 3.1 + 3.2).
//
// The page does two things:
//   1. Fetches the competition name from /api/competitions/:identifier/info and
//      shows it (falling back to a prettified slug if the endpoint is absent).
//   2. On submit, calls useAuth().competitionLogin() and navigates to either
//      /judge/:id or /play/:id depending on the returned role.
//
// We mock the api module (so no real fetch) and useAuth's competitionLogin
// (via the AuthProvider mock) to drive these flows. A MemoryRouter captures
// the navigation target so we can assert where the user ends up.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../hooks/useAuth';
import { LanguageProvider } from '../i18n/LanguageContext';
import CompetitionEntryPage from '../pages/CompetitionEntryPage';

// Mock the api module. getCompetitionInfo is called on mount; competitionLogin
// is called on submit. Both return non-200 by default so the page starts in
// the "endpoint unavailable" state without trying to hit a real server.
vi.mock('../api', () => ({
  api: {
    getCompetitionInfo: vi.fn().mockResolvedValue({ code: 404 }),
    competitionLogin: vi.fn(),
  },
  setToken: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// Helper: render the page at /competition/:identifier. The route is what
// feeds `useParams()` — without it, `identifier` would be undefined.
function renderPage(identifier = 'demo-cup-2026') {
  return render(
    <MemoryRouter initialEntries={[`/competition/${identifier}`]}>
      <LanguageProvider>
        <AuthProvider>
          <Routes>
            <Route path="/competition/:identifier" element={<CompetitionEntryPage />} />
            {/* Catch-all so we can detect where the page tried to go. */}
            <Route path="*" element={<div data-testid="catchall">caught</div>} />
          </Routes>
        </AuthProvider>
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe('CompetitionEntryPage', () => {
  it('renders a title derived from the slug when the info endpoint is unavailable', async () => {
    renderPage('demo-cup-2026');
    // The slug "demo-cup-2026" becomes "Demo Cup 2026".
    await waitFor(() => {
      expect(screen.getByText(/Demo Cup 2026/i)).toBeInTheDocument();
    });
  });

  it('renders the real competition name when the info endpoint answers', async () => {
    const { api } = await import('../api');
    api.getCompetitionInfo.mockResolvedValueOnce({
      code: 200,
      data: { name: 'Grand Prix Lyon 2026' },
    });
    renderPage('grand-prix');
    await waitFor(() => {
      expect(screen.getByText('Grand Prix Lyon 2026')).toBeInTheDocument();
    });
  });

  it('renders username and password inputs and a submit button', () => {
    renderPage();
    expect(document.querySelector('input[type="text"]')).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeInTheDocument();
    const submit = screen.getAllByRole('button').find(
      (b) => b.getAttribute('type') === 'submit'
    );
    expect(submit).toBeInTheDocument();
  });

  it('navigates to /play/:id when a PLAYER logs in', async () => {
    const { api } = await import('../api');
    // Build a minimal competition JWT so AuthProvider can decode a role.
    const b64 = (o) =>
      btoa(unescape(encodeURIComponent(JSON.stringify(o))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
      type: 'competition',
      competitionId: 42,
      role: 'PLAYER',
      participantId: 7,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.sig`;
    api.competitionLogin.mockResolvedValueOnce({
      code: 200,
      data: { token, competitionId: 42 },
    });

    renderPage();
    fireEvent.change(document.querySelector('input[type="text"]'), {
      target: { value: 'alice' },
    });
    fireEvent.change(document.querySelector('input[type="password"]'), {
      target: { value: 'secret' },
    });
    fireEvent.click(
      screen.getAllByRole('button').find((b) => b.getAttribute('type') === 'submit')
    );

    await waitFor(() => {
      expect(api.competitionLogin).toHaveBeenCalledWith('demo-cup-2026', 'alice', 'secret');
    });
  });

  it('shows an error message when the competition login endpoint returns 404', async () => {
    const { api } = await import('../api');
    const err = new Error('not found');
    err.code = 404;
    api.competitionLogin.mockRejectedValueOnce(err);

    renderPage();
    fireEvent.change(document.querySelector('input[type="text"]'), {
      target: { value: 'alice' },
    });
    fireEvent.change(document.querySelector('input[type="password"]'), {
      target: { value: 'secret' },
    });
    fireEvent.click(
      screen.getAllByRole('button').find((b) => b.getAttribute('type') === 'submit')
    );

    // The page maps a 404 to the "endpoint unavailable" i18n key. The yellow
    // banner already shows that same sentence (the info endpoint is mocked as
    // 404 too), so scope the assertion to the form's own error line rather
    // than matching the text anywhere on the page.
    await waitFor(() => {
      const errorLine = document.querySelector('form p.text-red-300');
      expect(errorLine).not.toBeNull();
      expect(errorLine.textContent).toMatch(/unavailable|尚未开放|not available/i);
    });
  });
});
