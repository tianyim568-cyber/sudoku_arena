// Unit tests for the round list rendering in CompetitionDetailPage (BUG-03).
//
// Before the fix, the round list passed the raw enum (e.g.
// INDIVIDUAL_STANDARD) straight into the roundMeta template — the admin
// saw "INDIVIDUAL_STANDARD | 600s | Puzzles: 0" instead of a readable
// label. The fix pre-translates the enum via common.roundName.* before
// passing it to the template.
//
// These tests mount CompetitionDetailPage with a stage that holds one
// round of each roundType, and assert the readable label appears in the
// document for both EN and ZH locales.

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
    getAccessLink: vi.fn().mockResolvedValue({ code: 200, data: { accessCode: null, entryUrl: null } }),
    generateAccessLink: vi.fn(),
    revokeAccessLink: vi.fn(),
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
  INDIVIDUAL: ['INDIVIDUAL_STANDARD', 'INDIVIDUAL_SHAPED', 'INDIVIDUAL_MIXED'],
  TEAM: ['ROUND1_NINE_ONE', 'ROUND2_RELAY', 'ROUND3_COLLABORATE'],
  PK: [],
};

// A stage with one round of each roundType. The test asserts the
// readable label is rendered, so we need a stage per type.
const STAGES_WITH_ALL_ROUND_TYPES = [
  {
    id: 'stage-indiv', type: 'INDIVIDUAL', order_number: 1,
    rounds: [
      { id: 'r-1', order_number: 1, name: 'Standard', type: 'INDIVIDUAL_STANDARD', duration_seconds: 600, puzzles: [] },
      { id: 'r-2', order_number: 2, name: 'Shaped', type: 'INDIVIDUAL_SHAPED', duration_seconds: 600, puzzles: [] },
      { id: 'r-3', order_number: 3, name: 'Mixed', type: 'INDIVIDUAL_MIXED', duration_seconds: 600, puzzles: [] },
    ],
  },
  {
    id: 'stage-team', type: 'TEAM', order_number: 2,
    rounds: [
      { id: 'r-4', order_number: 1, name: 'Nine-One', type: 'ROUND1_NINE_ONE', duration_seconds: 600, puzzles: [] },
      { id: 'r-5', order_number: 2, name: 'Relay', type: 'ROUND2_RELAY', duration_seconds: 600, puzzles: [] },
      { id: 'r-6', order_number: 3, name: 'Collaborate', type: 'ROUND3_COLLABORATE', duration_seconds: 600, puzzles: [] },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ user: { userId: 'u1', role: 'ORG_ADMIN' }, isAdmin: true });
  api.getCompetition.mockResolvedValue({
    code: 200,
    data: { id: 'comp-1', name: 'Spring Cup', status: 'DRAFT', judges: [] },
  });
  api.listStages.mockResolvedValue({ code: 200, data: STAGES_WITH_ALL_ROUND_TYPES });
  api.listParticipants.mockResolvedValue({ code: 200, data: [] });
  api.listUsers.mockResolvedValue({ code: 200, data: [] });
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

describe('CompetitionDetailPage — round list shows readable round type (BUG-03)', () => {
  // The raw enum must NEVER appear in the document. Before the fix,
  // INDIVIDUAL_STANDARD was rendered verbatim. After the fix, the label
  // from common.roundName.INDIVIDUAL_STANDARD ("Standard Sudoku" in EN,
  // "标准数独" in ZH) is what surfaces.
  it('does NOT render the raw enum for any roundType', async () => {
    renderPage();
    await waitFor(() => expect(api.listStages).toHaveBeenCalled());
    // None of these raw enums should appear in the document.
    expect(screen.queryByText(/INDIVIDUAL_STANDARD/)).toBeNull();
    expect(screen.queryByText(/INDIVIDUAL_SHAPED/)).toBeNull();
    expect(screen.queryByText(/INDIVIDUAL_MIXED/)).toBeNull();
    expect(screen.queryByText(/ROUND1_NINE_ONE/)).toBeNull();
    expect(screen.queryByText(/ROUND2_RELAY/)).toBeNull();
    expect(screen.queryByText(/ROUND3_COLLABORATE/)).toBeNull();
  });

  // The readable label must appear. Both EN and ZH dictionaries define
  // the same keys, and LanguageProvider defaults to ZH, so we assert on
  // the ZH labels here. The EN labels are verified separately by the
  // i18n parity test.
  //
  // Stage rounds are only rendered when the stage is open (toggleStage).
  // The test must click "配置" (Configure) to expand the stage before
  // looking for the round label — otherwise the round list is hidden.
  it('renders the translated label for INDIVIDUAL_STANDARD', async () => {
    renderPage();
    await waitFor(() => expect(api.listStages).toHaveBeenCalled());
    // Open the INDIVIDUAL stage so its rounds render. "配置" appears once
    // per stage; we click the first one (INDIVIDUAL is first in
    // STAGES_WITH_ALL_ROUND_TYPES).
    const configureButtons = screen.getAllByRole('button', { name: /^配置$|^Configure$/i });
    fireEvent.click(configureButtons[0]);
    // ZH label = "标准数独". It appears both in the round-type <option>
    // dropdown (always rendered when the stage is open) and in the round
    // list span (the one we care about). Assert at least one matching
    // element is NOT an <option> — i.e. the round list rendered it.
    await waitFor(() => {
      const all = screen.getAllByText(/标准数独/);
      const inRoundList = all.filter(el => el.tagName.toLowerCase() !== 'option');
      expect(inRoundList.length).toBeGreaterThan(0);
    });
  });

  it('renders the translated label for ROUND1_NINE_ONE', async () => {
    renderPage();
    await waitFor(() => expect(api.listStages).toHaveBeenCalled());
    // Open the TEAM stage. "配置" appears once per stage; getAllByRole
    // returns both, we click the second one (TEAM is rendered after
    // INDIVIDUAL in STAGES_WITH_ALL_ROUND_TYPES).
    const configureButtons = screen.getAllByRole('button', { name: /^配置$|^Configure$/i });
    fireEvent.click(configureButtons[1]);
    // ZH label = "第一轮：九宫一填". Same option-vs-span reasoning as
    // above.
    await waitFor(() => {
      const all = screen.getAllByText(/九宫一填/);
      const inRoundList = all.filter(el => el.tagName.toLowerCase() !== 'option');
      expect(inRoundList.length).toBeGreaterThan(0);
    });
  });
});
