// Unit tests for the Assign Judge picker on CompetitionDetailPage (BUG-01).
//
// Before the fix, handleAssignJudge did users.find(u => u.role === 'JUDGE')
// and always assigned the first judge in the list — the admin never chose.
// These tests pin the post-fix behaviour:
//   - the dropdown lists only JUDGE users not already assigned
//   - an already-assigned judge does NOT appear in the dropdown
//   - clicking Assign sends the selected judgeId to the API (not the first)
//   - the button is disabled when nothing is selected
//   - the dropdown is hidden when no unassigned judge is available

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import CompetitionDetailPage from '../pages/CompetitionDetailPage';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useParams: () => ({ id: 'comp-1' }), useNavigate: () => vi.fn() };
});

vi.mock('../api', () => ({
  api: {
    getCompetition: vi.fn(),
    listStages: vi.fn(),
    configureStages: vi.fn(),
    listParticipants: vi.fn(),
    listUsers: vi.fn(),
    getRoundTypes: vi.fn(),
    createStageRound: vi.fn(),
    assignJudge: vi.fn(),
    // AccessLinkSection renders on the admin view and calls these on mount.
    getAccessLink: vi.fn().mockResolvedValue({ code: 200, data: { accessCode: null, entryUrl: null } }),
    generateAccessLink: vi.fn(),
    revokeAccessLink: vi.fn(),
    // PublishPanel also renders on the admin view.
    getPublishability: vi.fn().mockResolvedValue({ code: 200, data: { status: 'DRAFT', publishable: true, missing: [] } }),
    publishCompetition: vi.fn(),
    cancelCompetition: vi.fn(),
    startCompetition: vi.fn(),
  },
  setToken: vi.fn(),
}));

vi.mock('../hooks/useAuth', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useAuth: vi.fn() };
});

const ROUND_TYPES = {
  TEAM: ['ROUND1_NINE_ONE'],
  INDIVIDUAL: ['INDIVIDUAL_STANDARD'],
  PK: [],
};

const USERS = [
  { id: 'u-judge-1', role: 'JUDGE', username: 'judge1', display_name: 'Judge One' },
  { id: 'u-judge-2', role: 'JUDGE', username: 'judge2', display_name: 'Judge Two' },
  { id: 'u-admin-1', role: 'ORG_ADMIN', username: 'admin1', display_name: 'Admin One' },
  { id: 'u-player-1', role: 'PLAYER', username: 'player1', display_name: 'Player One' },
];

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ user: { userId: 'u-admin-1', role: 'ORG_ADMIN' }, isAdmin: true });
  api.getCompetition.mockResolvedValue({
    code: 200,
    data: { id: 'comp-1', name: 'Spring Cup', status: 'DRAFT', judges: [] },
  });
  api.listStages.mockResolvedValue({ code: 200, data: [] });
  api.listParticipants.mockResolvedValue({ code: 200, data: [] });
  api.listUsers.mockResolvedValue({ code: 200, data: USERS });
  api.getRoundTypes.mockResolvedValue({ code: 200, data: ROUND_TYPES });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <CompetitionDetailPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe('CompetitionDetailPage — Assign Judge picker (BUG-01)', () => {
  it('lists unassigned judges in the dropdown', async () => {
    renderPage();
    const dropdown = await screen.findByLabelText(/assign judge|分配裁判/i);
    // Both judges are unassigned → both appear.
    expect(screen.getByRole('option', { name: 'Judge One' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Judge Two' })).toBeInTheDocument();
    // Admins and players do NOT appear.
    expect(screen.queryByRole('option', { name: 'Admin One' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Player One' })).toBeNull();
  });

  it('excludes already-assigned judges from the dropdown', async () => {
    // Judge One is already assigned to this competition.
    api.getCompetition.mockResolvedValue({
      code: 200,
      data: { id: 'comp-1', name: 'Spring Cup', status: 'DRAFT', judges: [{ id: 'u-judge-1', display_name: 'Judge One' }] },
    });
    renderPage();
    await screen.findByLabelText(/assign judge|分配裁判/i);
    // Only Judge Two remains in the dropdown.
    expect(screen.queryByRole('option', { name: 'Judge One' })).toBeNull();
    expect(screen.getByRole('option', { name: 'Judge Two' })).toBeInTheDocument();
  });

  it('disables the Assign button until a judge is picked', async () => {
    renderPage();
    const assignBtn = await screen.findByRole('button', { name: /^\+ assign judge|^\+ 分配裁判/i });
    expect(assignBtn).toBeDisabled();
  });

  it('sends the selected judgeId to the API, not the first one', async () => {
    api.assignJudge.mockResolvedValue({ code: 200, data: {} });
    renderPage();
    const dropdown = await screen.findByLabelText(/assign judge|分配裁判/i);
    // Pick Judge Two (not the first in the USERS list — Judge One is).
    fireEvent.change(dropdown, { target: { value: 'u-judge-2' } });
    const assignBtn = screen.getByRole('button', { name: /^\+ assign judge|^\+ 分配裁判/i });
    expect(assignBtn).not.toBeDisabled();
    fireEvent.click(assignBtn);
    await waitFor(() => expect(api.assignJudge).toHaveBeenCalledWith('comp-1', 'u-judge-2'));
  });

  it('hides the dropdown when every judge is already assigned', async () => {
    api.getCompetition.mockResolvedValue({
      code: 200,
      data: {
        id: 'comp-1', name: 'Spring Cup', status: 'DRAFT',
        judges: [
          { id: 'u-judge-1', display_name: 'Judge One' },
          { id: 'u-judge-2', display_name: 'Judge Two' },
        ],
      },
    });
    renderPage();
    // Give the listUsers call time to resolve.
    await waitFor(() => expect(api.listUsers).toHaveBeenCalled());
    // No dropdown — nobody to assign.
    expect(screen.queryByLabelText(/assign judge|分配裁判/i)).toBeNull();
  });
});
