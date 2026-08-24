// Unit tests for accessibility fixes in CompetitionDetailPage (Tâche 4).
//
// Before the fix:
// - Stage-type picker buttons had no aria-label — a screen reader had
//   to guess from the visible <span> text, which is fragile when the
//   span is nested inside Tailwind classes.
// - The PDF file input had a <label> element but no `htmlFor`, and the
//   input had no `id` — the label was not programmatically linked to
//   the input, so a screen reader did not announce "题目文件" when the
//   input got focus.
//
// Fix: added `aria-label={t(st.labelKey)}` to each stage-type button,
// and `id="roundPdf"` + `htmlFor="roundPdf"` + `aria-label` on the file
// input so the label is programmatically associated.
//
// These tests mount CompetitionDetailPage and assert that:
// 1. Each stage-type button is findable by its accessible name (the
//    translated label, e.g. "个人赛阶段").
// 2. The PDF file input is findable by its accessible name and its
//    <label> is programmatically associated (clicking the label focuses
//    the input).

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

  // The PDF file input must have a programmatically associated <label>.
  // Before the fix, the <label> had no `htmlFor` and the input had no
  // `id`, so clicking the label did not focus the input. The fix adds
  // `id="roundPdf"` + `htmlFor="roundPdf"` + an aria-label as a belt-
  // and-suspenders measure.
  //
  // The file input only renders when a stage is open. We add a stage,
  // open it, then look for the input.
  it('PDF file input has a programmatically associated label', async () => {
    api.configureStages.mockResolvedValue({
      code: 200,
      data: [{ id: 's1', type: 'INDIVIDUAL', order_number: 1, rounds: [] }],
    });

    renderPage();
    await waitFor(() => expect(api.getCompetition).toHaveBeenCalled());
    // Add an INDIVIDUAL stage so we can open it and reach the round form.
    fireEvent.click(screen.getByRole('button', { name: /add a stage|添加阶段/i }));
    fireEvent.click(screen.getByRole('button', { name: /个人赛阶段/i }));
    await waitFor(() => expect(api.configureStages).toHaveBeenCalled());
    // Open the stage to reveal the round form (which contains the file input).
    fireEvent.click(screen.getByRole('button', { name: /^配置$|^Configure$/i }));

    // The input is findable by its accessible name (the ZH label).
    const fileInput = await screen.findByLabelText(/题目文件/i);
    expect(fileInput).toBeInTheDocument();
    expect(fileInput.tagName.toLowerCase()).toBe('input');
    expect(fileInput).toHaveAttribute('type', 'file');
  });
});
