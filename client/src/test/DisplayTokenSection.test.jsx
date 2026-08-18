// Unit tests for DisplayTokenSection — the admin block that lets the judge
// generate, copy, and revoke the big-screen display token.
//
// The server routes are Sylvain's and are NOT tested here. What this file
// pins is the client behaviour the prompt calls out:
//
//   - NO_TOKEN state: a brand-new competition has no token in memory. The
//     block shows a "Generate" button, NOT an error.
//   - LINK state: after generation, the URL is shown, with a "Copy" button
//     that calls navigator.clipboard.writeText (no manual selection needed).
//   - REVOKE confirm: revoking cuts any screen currently using the token. A
//     stray click must not do that — window.confirm must be called first,
//     and cancelling it must NOT call the API.
//
// Unlike AccessLinkSection, there is no LOADING state and no initial GET:
// the server does not expose a GET for the display token, so the component
// starts in NO_TOKEN and learns the URL only after the admin clicks Generate.
//
// The "judge doesn't see the block" case is NOT tested here: the parent page
// gates visibility on isAdmin, and the parent's test covers that. This file
// tests the component in isolation.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import DisplayTokenSection from '../components/DisplayTokenSection';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    generateDisplayToken: vi.fn(),
    revokeDisplayToken: vi.fn(),
  },
  setToken: vi.fn(),
}));

function renderSection() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <DisplayTokenSection competitionId="comp-1" />
      </LanguageProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DisplayTokenSection — NO_TOKEN state', () => {
  it('shows a Generate button (not an error) when no token exists yet', () => {
    renderSection();
    const generate = screen.getByRole('button', { name: /generate token|生成令牌/i });
    expect(generate).toBeInTheDocument();
    // No error message is shown — "no token yet" is a valid state.
    expect(screen.queryByText(/could not|无法/i)).toBeNull();
  });

  it('does NOT call the API on mount — the server has no GET, and calling generate would revoke any existing token', () => {
    renderSection();
    expect(api.generateDisplayToken).not.toHaveBeenCalled();
    expect(api.revokeDisplayToken).not.toHaveBeenCalled();
  });
});

describe('DisplayTokenSection — generation', () => {
  it('shows the URL and a Copy button after generation succeeds', async () => {
    api.generateDisplayToken.mockResolvedValue({
      code: 200,
      data: { token: 'abc123', displayUrl: 'https://arena.example/display/abc123' },
    });
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /generate token|生成令牌/i }));

    const url = await screen.findByText(/arena\.example\/display\/abc123/);
    expect(url).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy|复制/i })).toBeInTheDocument();
  });

  it('shows an error when generation fails', async () => {
    api.generateDisplayToken.mockResolvedValue({ code: 50000, message: 'generate boom' });
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /generate token|生成令牌/i }));
    expect(await screen.findByText(/generate boom/)).toBeInTheDocument();
  });
});

describe('DisplayTokenSection — copy', () => {
  it('copies the URL to the clipboard when Copy is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    api.generateDisplayToken.mockResolvedValue({
      code: 200,
      data: { token: 'abc123', displayUrl: 'https://arena.example/display/abc123' },
    });
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: /generate token|生成令牌/i }));
    await screen.findByText(/arena\.example\/display\/abc123/);

    fireEvent.click(screen.getByRole('button', { name: /copy|复制/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://arena.example/display/abc123'));
    // The hint flips to "Copied" so the admin gets feedback.
    expect(screen.getByText(/copied|已复制/i)).toBeInTheDocument();
  });
});

describe('DisplayTokenSection — revoke confirmation', () => {
  it('does NOT call revoke when the admin cancels the confirm dialog', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: /^revoke$|^撤销$/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(api.revokeDisplayToken).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('calls revoke when the admin confirms', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.revokeDisplayToken.mockResolvedValue({ code: 200, data: null });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: /^revoke$|^撤销$/i }));

    await waitFor(() => expect(api.revokeDisplayToken).toHaveBeenCalledWith('comp-1'));
  });

  it('clears the URL from the screen after a successful revoke', async () => {
    // Generate first so the URL is visible, then revoke.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.generateDisplayToken.mockResolvedValue({
      code: 200,
      data: { token: 'abc123', displayUrl: 'https://arena.example/display/abc123' },
    });
    api.revokeDisplayToken.mockResolvedValue({ code: 200, data: null });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: /generate token|生成令牌/i }));
    await screen.findByText(/arena\.example\/display\/abc123/);

    fireEvent.click(screen.getByRole('button', { name: /^revoke$|^撤销$/i }));
    // After revoke, the URL disappears and the Generate button comes back.
    await waitFor(() => {
      expect(screen.queryByText(/arena\.example\/display\/abc123/)).toBeNull();
      expect(screen.getByRole('button', { name: /generate token|生成令牌/i })).toBeInTheDocument();
    });
  });

  it('shows an error when revoke fails but keeps the URL (still active server-side)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api.generateDisplayToken.mockResolvedValue({
      code: 200,
      data: { token: 'abc123', displayUrl: 'https://arena.example/display/abc123' },
    });
    api.revokeDisplayToken.mockResolvedValue({ code: 50000, message: 'revoke boom' });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: /generate token|生成令牌/i }));
    await screen.findByText(/arena\.example\/display\/abc123/);

    fireEvent.click(screen.getByRole('button', { name: /^revoke$|^撤销$/i }));
    expect(await screen.findByText(/revoke boom/)).toBeInTheDocument();
    // URL stays visible: the token is still valid server-side, the admin may
    // want to copy it before retrying.
    expect(screen.getByText(/arena\.example\/display\/abc123/)).toBeInTheDocument();
  });
});
