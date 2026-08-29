// Unit tests for the Stages section of CompetitionDetailPage.
//
// The stages API is DECLARATIVE: PUT /competitions/:id/stages replaces the
// whole list, deleting anything absent from it — along with that stage's
// rounds. Sending only the newly added stage would therefore silently destroy
// every other one. These tests pin that contract down.

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
    // AccessLinkSection renders on the admin view and calls these on mount.
    // They are not asserted in this file, but must exist as mocks so the
    // GET does not throw an unhandled rejection inside the test runner.
    getAccessLink: vi.fn().mockResolvedValue({ code: 200, data: { accessCode: null, entryUrl: null } }),
    generateAccessLink: vi.fn(),
    revokeAccessLink: vi.fn(),
    // PublishPanel also renders on the admin view and calls getPublishability
    // on mount. Same reason: not asserted here, but must exist as a mock.
    getPublishability: vi.fn().mockResolvedValue({ code: 200, data: { status: 'DRAFT', publishable: true, missing: [] } }),
    publishCompetition: vi.fn(),
    cancelCompetition: vi.fn(),
    startCompetition: vi.fn(),
  },
  setToken: vi.fn(),
}));

// The mapping the server serves from engine/RoundTypes.js.
const ROUND_TYPES = {
  TEAM: ['ROUND1_NINE_ONE', 'ROUND2_RELAY', 'ROUND3_COLLABORATE'],
  INDIVIDUAL: ['INDIVIDUAL_STANDARD', 'INDIVIDUAL_SHAPED', 'INDIVIDUAL_MIXED'],
  PK: [],
};

vi.mock('../hooks/useAuth', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useAuth: vi.fn() };
});

const EXISTING_STAGES = [
  { id: 'stage-1', type: 'INDIVIDUAL', order_number: 1, rounds: [] },
  { id: 'stage-2', type: 'TEAM', order_number: 2, rounds: [{ id: 'r-1' }] },
];

function renderPage({
  status = 'DRAFT',
  stages = EXISTING_STAGES,
  roundTypesResponse = { code: 200, data: ROUND_TYPES },
} = {}) {
  useAuth.mockReturnValue({ user: { userId: 'u1', role: 'ORG_ADMIN' }, isAdmin: true });
  api.getCompetition.mockResolvedValue({
    code: 200,
    data: { id: 'comp-1', name: 'Spring Cup', status, judges: [] },
  });
  api.listStages.mockResolvedValue({ code: 200, data: stages });
  api.listParticipants.mockResolvedValue({ code: 200, data: [] });
  api.listUsers.mockResolvedValue({ code: 200, data: [] });
  api.getRoundTypes.mockResolvedValue(roundTypesResponse);
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <CompetitionDetailPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

const findButton = (re) =>
  screen.queryAllByRole('button').find(b => re.test(b.textContent));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CompetitionDetailPage — stages', () => {
  it('lists the stages returned by the API', async () => {
    renderPage();
    await waitFor(() => expect(api.listStages).toHaveBeenCalledWith('comp-1'));
    expect(screen.getAllByText(/individual stage|个人赛阶段/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/team stage|团队赛阶段/i).length).toBeGreaterThan(0);
  });

  it('offers the head-to-head type but leaves it disabled', async () => {
    renderPage();
    await waitFor(() => expect(api.listStages).toHaveBeenCalled());

    fireEvent.click(findButton(/add a stage|添加阶段/i));

    const pk = findButton(/head-to-head|对抗赛/i);
    expect(pk).toBeDefined();
    expect(pk).toBeDisabled();
  });

  // The guard that matters: adding one stage must resend the existing ones,
  // ids included, or the server deletes them and their rounds with them.
  it('resends every existing stage, with its id, when adding a new one', async () => {
    api.configureStages.mockResolvedValue({ code: 200, data: EXISTING_STAGES });
    renderPage();
    await waitFor(() => expect(api.listStages).toHaveBeenCalled());

    fireEvent.click(findButton(/add a stage|添加阶段/i));
    fireEvent.click(findButton(/individual stage|个人赛阶段/i));

    await waitFor(() => expect(api.configureStages).toHaveBeenCalled());
    const [, sent] = api.configureStages.mock.calls[0];

    expect(sent).toHaveLength(3);
    expect(sent[0]).toEqual({ id: 'stage-1', type: 'INDIVIDUAL', orderNumber: 1 });
    expect(sent[1]).toEqual({ id: 'stage-2', type: 'TEAM', orderNumber: 2 });
    // The new one carries no id — that is how the server knows to create it.
    expect(sent[2]).toEqual({ type: 'INDIVIDUAL', orderNumber: 3 });
  });

  it('refuses to remove the last stage without calling the API', async () => {
    renderPage({ stages: [EXISTING_STAGES[0]] });
    await waitFor(() => expect(api.listStages).toHaveBeenCalled());

    fireEvent.click(findButton(/^remove$|^删除$/i));

    expect(api.configureStages).not.toHaveBeenCalled();
  });

  it('hides the stage controls once the competition is running', async () => {
    renderPage({ status: 'RUNNING' });
    await waitFor(() => expect(api.listStages).toHaveBeenCalled());

    expect(findButton(/add a stage|添加阶段/i)).toBeUndefined();
  });
});

// Configuring one stage: adding its rounds.
describe('CompetitionDetailPage — rounds inside a stage', () => {
  const openFirstStage = async () => {
    renderPage();
    await waitFor(() => expect(api.getRoundTypes).toHaveBeenCalled());
    // The stage toggle button now says "Add a round" / "添加轮次" (addRound key)
    // instead of "Configure" / "配置" (configureStage key).
    fireEvent.click(screen.getAllByRole('button', { name: /add a round|添加轮次/i })[0]);
  };

  // Round creation moved from inline form to a modal (2026-08-29).
  // After the stage is open, a separate "Add the round" / "添加轮次" button
  // (addRoundSubmit key) appears inside the stage panel — that one opens the modal.
  const openRoundModal = () => {
    fireEvent.click(findButton(/add the round|添加轮次/i));
  };

  // The whole point of serving the mapping: an INDIVIDUAL stage must not offer
  // team rounds. The server refuses the mismatch with 40011, but the dropdown
  // should never propose it in the first place.
  it('offers only the round types of the stage being configured', async () => {
    await openFirstStage(); // stage-1 is INDIVIDUAL
    openRoundModal();

    const select = await screen.findByRole('combobox');
    const values = [...select.options].map(o => o.value);
    expect(values).toEqual(ROUND_TYPES.INDIVIDUAL);
    expect(values).not.toContain('ROUND1_NINE_ONE');
  });

  it('creates the round against the stage, not the competition', async () => {
    api.createStageRound.mockResolvedValue({ code: 200, data: { id: 'r-9' } });
    await openFirstStage();
    openRoundModal();

    // The judge-name input also has role "textbox", so findByRole('textbox')
    // is ambiguous. Target the round-name placeholder instead.
    const nameInput = await screen.findByPlaceholderText(/round name|轮次名称/i);
    fireEvent.change(nameInput, { target: { value: 'Solo 1' } });

    // Submit the modal form via its submit button inside the form.
    const submitBtn = screen.getAllByRole('button', { name: /add the round|添加轮次/i })
      .find(b => b.closest('form'));
    fireEvent.click(submitBtn);

    await waitFor(() => expect(api.createStageRound).toHaveBeenCalled());
    const [competitionId, stageId, body] = api.createStageRound.mock.calls[0];
    expect(competitionId).toBe('comp-1');
    expect(stageId).toBe('stage-1');
    expect(body.roundType).toBe('INDIVIDUAL_STANDARD');
    expect(body.name).toBe('Solo 1');
  });

  // Both an empty category and a failed request leave the list empty, but they
  // mean opposite things. Reporting "no round type for this stage" when the
  // call actually 404'd sends the reader hunting in the wrong place — which is
  // exactly what happened against a server started before the route existed.
  it('reports a failed round-type request instead of blaming the stage', async () => {
    renderPage({ roundTypesResponse: { code: 404, message: 'HTTP 404', data: null } });
    await waitFor(() => expect(api.getRoundTypes).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole('button', { name: /add a round|添加轮次/i })[0]);

    expect(await screen.findByText(/HTTP 404/)).toBeInTheDocument();
    expect(screen.queryByText(/no round type is available|暂无可用的轮次类型/i)).toBeNull();
  });

  it('says so when a stage category has no round type yet', async () => {
    renderPage({ stages: [{ id: 'stage-pk', type: 'PK', order_number: 1, rounds: [] }] });
    await waitFor(() => expect(api.getRoundTypes).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole('button', { name: /add a round|添加轮次/i })[0]);

    expect(await screen.findByText(/no round type is available|暂无可用的轮次类型/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
