// Unit tests for accessibility fixes in CompetitionDetailPage (Tâche 4).
//
// Before the fix:
// - Stage-type picker buttons had no aria-label — a screen reader had
//   to guess from the visible <span> text, which is fragile when the
//   span is nested inside Tailwind classes.
// The disabled PDF-in-round-form field was removed on 2026-08-24 when
// the per-round `RoundPdfImport` component took over (product decision:
// every PDF batch is tied to a specific round). Its a11y counterpart
// lives in RoundPdfImport.jsx (`aria-label={t('roundPdfImport.selectFile')}`)
// and doesn't need to be exercised from CompetitionDetailPage tests
// any more.
//
// This file now covers just the stage-type buttons.

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
  INDIVIDUAL: ['INDIVIDUAL_STANDARD'],
  TEAM: ['ROUND1_NINE_ONE'],
  PK: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuth.mockReturnValue({ user: { userId: 'u1', role: 'ORG_ADMIN' }, isAdmin: true });
  api.getCompetition.mockResolvedValue({
    code: 200,
    data: { id: 'comp-1', name: 'Spring Cup', status: 'DRAFT', judges: [] },
  });
  api.listStages.mockResolvedValue({ code: 200, data: [] });
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

describe('CompetitionDetailPage — a11y stage-type buttons + file input (Tâche 4)', () => {
  // The stage-type picker is hidden until the admin clicks "Add a stage".
  // Each button must be findable by its accessible name (the translated
  // label). Before the fix, the button had no aria-label and the only
  // text was a nested <span> — a screen reader would read it, but
  // getByRole('button', { name: ... }) is the canonical a11y check.
  it('stage-type buttons are findable by their accessible name', async () => {
    renderPage();
    await waitFor(() => expect(api.getCompetition).toHaveBeenCalled());
    // Click "Add a stage" to reveal the picker.
    fireEvent.click(screen.getByRole('button', { name: /add a stage|添加阶段/i }));
    // ZH labels from competitionDetail.stageType{Individual,Team,PK}.
    expect(screen.getByRole('button', { name: /个人赛阶段/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /团队赛阶段/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /对抗赛阶段/i })).toBeInTheDocument();
  });

});
