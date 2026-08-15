// Unit tests for AccessLinkSection — the admin block that shows the player
// entry link.
//
// The server routes are Sylvain's and are NOT tested here. What this file
// pins is the client behaviour the prompt calls out:
//
//   - LOADING state: while the GET is in flight, neither "no link" nor the
//     URL is shown. Flashing the wrong state would make the admin click
//     "Generate" on a competition that already has a link.
//   - NO_LINK state: a brand-new competition has no code yet. The block
//     shows a "Generate" button, NOT an error.
//   - LINK state: the URL is shown, with a "Copy" button that calls
//     navigator.clipboard.writeText (no manual selection needed).
//   - REGENERATE confirm: regenerating revokes the old link everywhere it
//     was distributed. A stray click must not do that — window.confirm must
//     be called first, and cancelling it must NOT call the API.
//
// The "judge doesn't see the block" case is NOT tested here: the parent
// page gates visibility on isAdmin, and the parent's test already covers
// that. This file tests the component in isolation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import AccessLinkSection from '../components/AccessLinkSection';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    getAccessLink: vi.fn(),
    generateAccessLink: vi.fn(),
    revokeAccessLink: vi.fn(),
  },
  setToken: vi.fn(),
}));

function renderSection() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <AccessLinkSection competitionId="comp-1" />
      </LanguageProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AccessLinkSection — states', () => {
  it('shows a loading state before the first GET resolves', async () => {
    // Never-resolving promise so the LOADING state stays for the assertion.
    api.getAccessLink.mockReturnValue(new Promise(() => {}));
    renderSection();
    expect(screen.getByText(/loading|加载/i)).toBeInTheDocument();
  });

  it('shows a Generate button (not an error) when no link exists yet', async () => {
    api.getAccessLink.mockResolvedValue({
      code: 200,
      data: { accessCode: null, entryUrl: null },
    });
    renderSection();
    const generate = await screen.findByRole('button', { name: /generate|生成/i });
    expect(generate).toBeInTheDocument();
    // No error message is shown — "no link yet" is a valid state.
    expect(screen.queryByText(/could not|无法/i)).toBeNull();
  });

  it('shows the entry URL and a Copy button when a link exists', async () => {
    api.getAccessLink.mockResolvedValue({
      code: 200,
      data: { accessCode: 'abc12345', entryUrl: 'https://arena.example/competition/abc12345' },
    });
    renderSection();
    const url = await screen.findByText(/arena\.example\/competition\/abc12345/);
    expect(url).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy|复制/i })).toBeInTheDocument();
  });

  it('copies the URL to the clipboard when Copy is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    api.getAccessLink.mockResolvedValue({
      code: 200,
      data: { accessCode: 'abc12345', entryUrl: 'https://arena.example/competition/abc12345' },
    });
    renderSection();
    await screen.findByText(/arena\.example\/competition\/abc12345/);
    fireEvent.click(screen.getByRole('button', { name: /copy|复制/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://arena.example/competition/abc12345'));
    // The hint flips to "Copied" so the admin gets feedback.
    expect(screen.getByText(/copied|已复制/i)).toBeInTheDocument();
  });
});

describe('AccessLinkSection — regenerate confirmation', () => {
  beforeEach(() => {
    api.getAccessLink.mockResolvedValue({
      code: 200,
      data: { accessCode: 'abc12345', entryUrl: 'https://arena.example/competition/abc12345' },
    });
  });

  it('does NOT call generate when the admin cancels the confirm dialog', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderSection();
    await screen.findByText(/arena\.example\/competition\/abc12345/);

    fireEvent.click(screen.getByRole('button', { name: /regenerate|重新生成/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(api.generateAccessLink).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('calls generate when the admin confirms', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.generateAccessLink.mockResolvedValue({
      code: 200,
      data: { accessCode: 'newcode99', entryUrl: 'https://arena.example/competition/newcode99' },
    });
    renderSection();
    await screen.findByText(/arena\.example\/competition\/abc12345/);

    fireEvent.click(screen.getByRole('button', { name: /regenerate|重新生成/i }));

    await waitFor(() => expect(api.generateAccessLink).toHaveBeenCalledWith('comp-1'));
    // The URL updates to the new code.
    expect(screen.getByText(/arena\.example\/competition\/newcode99/)).toBeInTheDocument();
  });
});

describe('AccessLinkSection — error handling', () => {
  it('shows an error message when the GET fails', async () => {
    api.getAccessLink.mockResolvedValue({ code: 50000, message: 'boom' });
    renderSection();
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });

  it('shows an error message when generation fails', async () => {
    api.getAccessLink.mockResolvedValue({
      code: 200,
      data: { accessCode: null, entryUrl: null },
    });
    api.generateAccessLink.mockResolvedValue({ code: 50000, message: 'generate boom' });
    renderSection();
    const generate = await screen.findByRole('button', { name: /generate|生成/i });
    fireEvent.click(generate);
    expect(await screen.findByText(/generate boom/)).toBeInTheDocument();
  });
});
