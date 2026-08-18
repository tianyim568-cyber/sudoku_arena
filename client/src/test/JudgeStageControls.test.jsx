// Tests for the judge console's stage controls — and, just as importantly,
// for the status values the whole page keys off.
//
// Why the status tests matter as much as the buttons: this page used to test
// for 'PENDING' and 'NOT_STARTED', values the server stopped writing at the
// competition→stage migration. Nothing failed. No error, no warning — the
// buttons simply never rendered, and the console looked like a page that had
// nothing to offer. A test that renders with the REAL status values is the
// only thing that catches that class of bug.
//
// Why the stage buttons exist at all: GameOrchestrator.startRound reads the
// stage context and throws without it, so a round cannot be started until a
// stage has been opened. Before these buttons, a judge could start a
// competition and then go no further.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import JudgeControlPage from '../pages/JudgeControlPage';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getCompetition: vi.fn(),
    listStages: vi.fn(),
    getRoomStatus: vi.fn(),
    startCompetition: vi.fn(),
    startStage: vi.fn(),
    startNextStage: vi.fn(),
    startRound: vi.fn(),
    endRound: vi.fn(),
    pauseCompetition: vi.fn(),
    resumeCompetition: vi.fn(),
    endCompetition: vi.fn(),
  },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'j1', role: 'JUDGE' }, isAdmin: false }),
}));

// DisplayTokenSection does its own fetching; it is covered by its own tests.
vi.mock('../components/DisplayTokenSection', () => ({
  default: () => null,
}));

const stage = (id, order, status) => ({
  id, order_number: order, type: 'INDIVIDUAL', status, rounds: [{ id: `${id}-r1` }],
});

function renderPage({ competitionStatus = 'RUNNING', stages = [] } = {}) {
  api.getCompetition.mockResolvedValue({
    code: 200,
    data: { id: 'c1', name: 'Spring Cup', status: competitionStatus, rounds: [] },
  });
  api.listStages.mockResolvedValue({ code: 200, data: stages });
  api.getRoomStatus.mockResolvedValue({ code: 200, data: null });
  // The page reads :competitionId from the route. Rendering it under a bare
  // MemoryRouter would give useParams() an empty object, and every call would
  // go out with an undefined id — the page would still render, and the test
  // would pass on the visible parts while the requests were nonsense.
  return render(
    <MemoryRouter initialEntries={['/judge/c1']}>
      <LanguageProvider>
        <Routes>
          <Route path="/judge/:competitionId" element={<JudgeControlPage />} />
        </Routes>
      </LanguageProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JudgeControlPage — competition status values', () => {
  // The regression that made most of this page inert.
  it('offers "start competition" on a PUBLISHED competition', async () => {
    renderPage({ competitionStatus: 'PUBLISHED' });
    expect(await screen.findByRole('button', { name: /start competition|开始赛事/i })).toBeInTheDocument();
  });

  it('offers "start competition" on a DRAFT competition too', async () => {
    renderPage({ competitionStatus: 'DRAFT' });
    expect(await screen.findByRole('button', { name: /start competition|开始赛事/i })).toBeInTheDocument();
  });

  it('offers pause and end while RUNNING', async () => {
    renderPage({ competitionStatus: 'RUNNING' });
    expect(await screen.findByRole('button', { name: /pause|暂停/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /end competition|结束赛事/i })).toBeInTheDocument();
  });
});

describe('JudgeControlPage — stage controls', () => {
  it('offers to start a waiting stage while the competition is running', async () => {
    renderPage({ stages: [stage('s1', 1, 'WAITING')] });
    const btn = await screen.findByRole('button', { name: /start this stage|开始本阶段/i });
    fireEvent.click(btn);
    await waitFor(() => expect(api.startStage).toHaveBeenCalledWith('c1', 's1'));
  });

  // Only one stage runs at a time. Offering "start" on stage 2 while stage 1
  // is live would invite an action the engine refuses.
  it('does not offer to start a stage while another one is running', async () => {
    renderPage({ stages: [stage('s1', 1, 'RUNNING'), stage('s2', 2, 'WAITING')] });
    await screen.findByText(/Stage 1|第 1 阶段/);
    expect(screen.queryByRole('button', { name: /start this stage|开始本阶段/i })).toBeNull();
  });

  it('does not offer stage controls before the competition is running', async () => {
    renderPage({ competitionStatus: 'PUBLISHED', stages: [stage('s1', 1, 'WAITING')] });
    await screen.findByText(/Stage 1|第 1 阶段/);
    expect(screen.queryByRole('button', { name: /start this stage|开始本阶段/i })).toBeNull();
    expect(screen.getByText(/start the competition before|请先开始赛事/i)).toBeInTheDocument();
  });

  it('offers "next stage" once one has finished and another is waiting', async () => {
    renderPage({ stages: [stage('s1', 1, 'FINISHED'), stage('s2', 2, 'WAITING')] });
    const btn = await screen.findByRole('button', { name: /next stage|下一阶段/i });
    fireEvent.click(btn);
    await waitFor(() => expect(api.startNextStage).toHaveBeenCalledWith('c1'));
  });

  // The server refuses to advance without a loaded stage context, so we must
  // not offer the action before any stage has run.
  it('does not offer "next stage" when no stage has finished', async () => {
    renderPage({ stages: [stage('s1', 1, 'WAITING'), stage('s2', 2, 'WAITING')] });
    await screen.findByText(/Stage 1|第 1 阶段/);
    expect(screen.queryByRole('button', { name: /next stage|下一阶段/i })).toBeNull();
  });

  it('does not offer "next stage" while a stage is still running', async () => {
    renderPage({ stages: [stage('s1', 1, 'FINISHED'), stage('s2', 2, 'RUNNING'), stage('s3', 3, 'WAITING')] });
    await screen.findByText(/Stage 1|第 1 阶段/);
    expect(screen.queryByRole('button', { name: /next stage|下一阶段/i })).toBeNull();
  });

  it('renders nothing stage-related when the competition has no stages', async () => {
    renderPage({ stages: [] });
    await screen.findByText('Spring Cup');
    expect(screen.queryByText(/stage controls|阶段控制/i)).toBeNull();
  });
});
