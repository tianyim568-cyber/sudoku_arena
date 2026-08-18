// Unit tests for PublishPanel — the single, up-to-date readiness panel.
//
// What this file pins is the behaviour the prompt calls out as the one that
// matters most: "on ajoute une étape après la publication". After the admin
// publishes and then adds an unconfigured stage, the panel must reflect that
// the competition is no longer publishable — the Start button is disabled
// until the new stage is configured, even though the status column still
// says PUBLISHED.
//
// The server is the source of truth: the panel only displays what
// GET /publishability returns. So these tests mock the API and assert the
// panel renders the state it was given. The server-side re-verification is
// tested in routes-publish.test.js.
//
// Not tested here: the "judge does not see the panel" case — the parent page
// gates visibility on isAdmin, and the parent's test already covers that.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import PublishPanel from '../components/PublishPanel';
import { api } from '../api';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../api', () => ({
  api: {
    getPublishability: vi.fn(),
    publishCompetition: vi.fn(),
    cancelCompetition: vi.fn(),
    startCompetition: vi.fn(),
  },
  setToken: vi.fn(),
}));

function renderPanel({ competitionId = 'comp-1', status = 'DRAFT' } = {}) {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <PublishPanel competitionId={competitionId} status={status} />
      </LanguageProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PublishPanel — DRAFT (not yet published)', () => {
  it('shows a loading state before the GET resolves', async () => {
    // Never-resolving promise so the loading state stays for the assertion.
    api.getPublishability.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByText(/loading|加载/i)).toBeInTheDocument();
  });

  it('enables Publish when the server says publishable', async () => {
    api.getPublishability.mockResolvedValue({
      code: 200,
      data: { status: 'DRAFT', publishable: true, missing: [] },
    });
    renderPanel();
    const publish = await screen.findByRole('button', { name: /^publish$|^发布$/i });
    expect(publish).not.toBeDisabled();
  });

  it('disables Publish when the server says not publishable, and lists every missing criterion', async () => {
    // Break all four criteria at once: the admin must see the full punch
    // list, not just the first blocker.
    api.getPublishability.mockResolvedValue({
      code: 200,
      data: {
        status: 'DRAFT',
        publishable: false,
        missing: ['NO_JUDGE', 'NO_PARTICIPANT', 'STAGE_EMPTY', 'ROUND_EMPTY'],
      },
    });
    renderPanel();
    const publish = await screen.findByRole('button', { name: /^publish$|^发布$/i });
    expect(publish).toBeDisabled();
    // Every missing criterion has its own line in the checklist.
    expect(screen.getAllByText(/judge|裁判/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/participant|参赛者/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/every stage|每个阶段/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/every round|每个轮次/i).length).toBeGreaterThan(0);
  });

  it('calls POST /publish when Publish is clicked', async () => {
    api.getPublishability.mockResolvedValue({
      code: 200,
      data: { status: 'DRAFT', publishable: true, missing: [] },
    });
    api.publishCompetition.mockResolvedValue({
      code: 200,
      data: { id: 'comp-1', status: 'PUBLISHED' },
    });
    renderPanel();
    const publish = await screen.findByRole('button', { name: /^publish$|^发布$/i });
    fireEvent.click(publish);
    await waitFor(() => expect(api.publishCompetition).toHaveBeenCalledWith('comp-1'));
  });

  it('shows the server refusal message when publish is refused', async () => {
    // The client snapshot says publishable (the admin clicked Publish just
    // before a stage was removed, or the GET is stale). The server re-checks
    // from the real state and refuses. The message must reach the admin —
    // "Impossible to publish" alone is useless.
    api.getPublishability.mockResolvedValue({
      code: 200,
      data: { status: 'DRAFT', publishable: true, missing: [] },
    });
    api.publishCompetition.mockResolvedValue({
      code: 40010,
      message: '无法发布：存在没有轮次的阶段',
      data: { missing: ['STAGE_EMPTY'] },
    });
    renderPanel();
    const publish = await screen.findByRole('button', { name: /^publish$|^发布$/i });
    fireEvent.click(publish);
    expect(await screen.findByText(/存在没有轮次的阶段/)).toBeInTheDocument();
  });
});

describe('PublishPanel — PUBLISHED', () => {
  it('shows the Cancel and Start buttons when publishable', async () => {
    api.getPublishability.mockResolvedValue({
      code: 200,
      data: { status: 'PUBLISHED', publishable: true, missing: [] },
    });
    renderPanel({ status: 'PUBLISHED' });
    await screen.findByRole('button', { name: /cancel publication|取消发布/i });
    const start = screen.getByRole('button', { name: /start|开始赛事/i });
    expect(start).not.toBeDisabled();
  });

  // THE case Louise called out: "on ajoute une étape après la publication".
  // The status column still says PUBLISHED (we do not auto-downgrade), but
  // the publishability rule must recompute from the real state. The Start
  // button is disabled, and a warning tells the admin why.
  it('disables Start and shows a warning when a stage was added after publication', async () => {
    api.getPublishability.mockResolvedValue({
      code: 200,
      data: {
        status: 'PUBLISHED',
        publishable: false,
        missing: ['STAGE_EMPTY'],
      },
    });
    renderPanel({ status: 'PUBLISHED' });
    const start = await screen.findByRole('button', { name: /start|开始赛事/i });
    expect(start).toBeDisabled();
    // The warning must say "published but no longer ready" so the admin
    // does not think the button is broken.
    expect(screen.getByText(/no longer ready|不再就绪/i)).toBeInTheDocument();
  });

  it('calls POST /cancel when the admin confirms', async () => {
    api.getPublishability.mockResolvedValue({
      code: 200,
      data: { status: 'PUBLISHED', publishable: true, missing: [] },
    });
    api.cancelCompetition.mockResolvedValue({
      code: 200,
      data: { id: 'comp-1', status: 'DRAFT' },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPanel({ status: 'PUBLISHED' });
    const cancel = await screen.findByRole('button', { name: /cancel publication|取消发布/i });
    fireEvent.click(cancel);
    await waitFor(() => expect(api.cancelCompetition).toHaveBeenCalledWith('comp-1'));
  });

  it('does NOT call cancel when the admin cancels the confirm', async () => {
    // Cancel is destructive: it destroys the access link. A stray click must
    // not do that — the confirm dialog is the guard, and cancelling it
    // leaves everything untouched.
    api.getPublishability.mockResolvedValue({
      code: 200,
      data: { status: 'PUBLISHED', publishable: true, missing: [] },
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPanel({ status: 'PUBLISHED' });
    const cancel = await screen.findByRole('button', { name: /cancel publication|取消发布/i });
    fireEvent.click(cancel);
    expect(confirmSpy).toHaveBeenCalled();
    expect(api.cancelCompetition).not.toHaveBeenCalled();
  });

  it('calls POST /start when Start is clicked', async () => {
    api.getPublishability.mockResolvedValue({
      code: 200,
      data: { status: 'PUBLISHED', publishable: true, missing: [] },
    });
    api.startCompetition.mockResolvedValue({ code: 200, data: {} });
    renderPanel({ status: 'PUBLISHED' });
    const start = await screen.findByRole('button', { name: /start|开始赛事/i });
    fireEvent.click(start);
    await waitFor(() => expect(api.startCompetition).toHaveBeenCalledWith('comp-1'));
  });
});

describe('PublishPanel — RUNNING / FINISHED', () => {
  it('renders nothing when the competition is RUNNING', () => {
    const { container } = renderPanel({ status: 'RUNNING' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the competition is FINISHED', () => {
    const { container } = renderPanel({ status: 'FINISHED' });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PublishPanel — refresh on status change', () => {
  // After a successful publish, the parent reloads the competition and the
  // status prop changes from DRAFT to PUBLISHED. The panel must re-fetch
  // the publishability snapshot so the Start button lights up without a
  // manual page reload.
  it('re-fetches publishability when the status prop changes', async () => {
    api.getPublishability.mockResolvedValue({
      code: 200,
      data: { status: 'DRAFT', publishable: true, missing: [] },
    });
    const { rerender } = renderPanel({ status: 'DRAFT' });
    await waitFor(() => expect(api.getPublishability).toHaveBeenCalledTimes(1));

    api.getPublishability.mockResolvedValue({
      code: 200,
      data: { status: 'PUBLISHED', publishable: true, missing: [] },
    });
    rerender(
      <MemoryRouter>
        <LanguageProvider>
          <PublishPanel competitionId="comp-1" status="PUBLISHED" />
        </LanguageProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(api.getPublishability).toHaveBeenCalledTimes(2));
  });
});
