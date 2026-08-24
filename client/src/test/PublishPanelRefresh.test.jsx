// Unit tests for the PublishPanel refresh-on-mutation behaviour (BUG-02).
//
// Before the fix, PublishPanel only refetched its publishability snapshot
// when the `status` prop changed. Adding a stage after publication did NOT
// change the status (it stays PUBLISHED), so the "every stage configured"
// check stayed green even though the new stage was empty — the admin saw
// a stale checklist until a manual page reload.
//
// Fix: the parent CompetitionDetailPage increments publishRefreshKey after
// every successful mutation of sibling panels (stages, rounds, participants,
// judges) and passes it to PublishPanel as refreshKey. The panel adds it to
// its useEffect deps → refetch on every bump.
//
// These tests mount the full CompetitionDetailPage and simulate the "add
// stage after publication" flow with a mocked API.

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
    deleteParticipants: vi.fn(),
    exportParticipants: vi.fn(),
    getAccessLink: vi.fn().mockResolvedValue({ code: 200, data: { accessCode: null, entryUrl: null } }),
    generateAccessLink: vi.fn(),
    revokeAccessLink: vi.fn(),
    getPublishability: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ user: { userId: 'u1', role: 'ORG_ADMIN' }, isAdmin: true });
});

function renderPage({
  status = 'PUBLISHED',
  initialStages = [],
  initialMissing = ['NO_STAGE'],
  initialPublishable = false,
  users = [],
} = {}) {
  api.getCompetition.mockResolvedValue({
    code: 200,
    data: { id: 'comp-1', name: 'Spring Cup', status, judges: [] },
  });
  api.listStages.mockResolvedValue({ code: 200, data: initialStages });
  api.listParticipants.mockResolvedValue({ code: 200, data: [] });
  api.listUsers.mockResolvedValue({ code: 200, data: users });
  api.getRoundTypes.mockResolvedValue({ code: 200, data: ROUND_TYPES });
  api.getPublishability.mockResolvedValue({
    code: 200,
    data: { status, publishable: initialPublishable, missing: initialMissing },
  });
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <CompetitionDetailPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

describe('PublishPanel — refresh on sibling mutation (BUG-02)', () => {
  // THE case: admin published, then adds an unconfigured stage. The status
  // stays PUBLISHED (we do not auto-downgrade), but the publishability
  // changed. Before the fix, the panel kept the old snapshot → the Start
  // button stayed enabled when it should be disabled. After the fix, the
  // parent bumps publishRefreshKey after configureStages succeeds, and the
  // panel refetches → Start is disabled.
  it('refetches publishability after a stage is added', async () => {
    // configureStages must be mocked BEFORE the click — the handler reads
    // res.code synchronously after the await.
    api.configureStages.mockResolvedValue({
      code: 200,
      data: [{ id: 's1', type: 'INDIVIDUAL', order_number: 1 }],
    });

    renderPage({ status: 'PUBLISHED', initialMissing: ['NO_STAGE'] });
    // The panel loads → first GET has run.
    await waitFor(() => expect(api.getPublishability).toHaveBeenCalledTimes(1));

    // Click "Add a stage" then pick "Individual".
    fireEvent.click(screen.getByRole('button', { name: /add a stage|添加阶段/i }));
    fireEvent.click(screen.getByRole('button', { name: /individual stage|个人赛阶段/i }));

    // configureStages resolves; loadStages is called; publishRefreshKey
    // bumps → PublishPanel refetches.
    await waitFor(() => expect(api.configureStages).toHaveBeenCalled());
    await waitFor(() => expect(api.getPublishability).toHaveBeenCalledTimes(2));
  });

  // Refetch after assigning a judge — the "Has judges" check must flip.
  it('refetches publishability after a judge is assigned', async () => {
    api.assignJudge.mockResolvedValue({ code: 200, data: {} });

    renderPage({
      status: 'DRAFT',
      initialMissing: ['NO_JUDGE'],
      users: [{ id: 'u-judge-1', role: 'JUDGE', username: 'judge1', display_name: 'Judge One' }],
    });
    // Wait for the first publishability fetch to finish.
    await waitFor(() => expect(api.getPublishability).toHaveBeenCalledTimes(1));
    // Wait for the users list to load so the dropdown renders.
    const dropdown = await screen.findByLabelText(/assign judge|分配裁判/i);
    fireEvent.change(dropdown, { target: { value: 'u-judge-1' } });
    fireEvent.click(screen.getByRole('button', { name: /^\+ assign judge|^\+ 分配裁判/i }));

    await waitFor(() => expect(api.assignJudge).toHaveBeenCalledWith('comp-1', 'u-judge-1'));
    // load() refetches competition + bumpPublishRefresh → PublishPanel
    // refetches.
    await waitFor(() => expect(api.getPublishability).toHaveBeenCalledTimes(2));
  });
});
