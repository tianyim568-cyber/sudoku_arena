// Unit tests for DashboardJudgesPage — the judge creation UI closes the
// "no dedicated UI" gap that was blocking the MVP acceptance criterion
// "judge creation with generated credentials".
//
// The page goes through POST /users (not POST /competitions/:id/judges)
// to sidestep the ISSUE-027 verb+path collision. We test that:
//   1. Only JUDGE users show up in the list (server returns every role).
//   2. Creating a judge calls api.createUser with role: 'JUDGE' and
//      surfaces the generated credentials in a banner exactly once.
//   3. A server error stops the flow and shows the message.
//   4. The status toggle flips ACTIVE ↔ INACTIVE via updateUserStatus.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';
import DashboardJudgesPage from '../pages/DashboardJudgesPage';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUserStatus: vi.fn(),
  },
  setToken: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPage() {
  return render(
    <LanguageProvider>
      <DashboardJudgesPage />
    </LanguageProvider>
  );
}

// listUsers returns EVERY role for the org — mix in a player and an admin
// to prove the client-side filter really keeps only judges.
const ALL_USERS = [
  { id: 'u1', username: 'judge_alice', role: 'JUDGE', status: 'ACTIVE', created_at: '2026-08-01T00:00:00Z' },
  { id: 'u2', username: 'judge_bob', role: 'JUDGE', status: 'INACTIVE', created_at: '2026-08-02T00:00:00Z' },
  { id: 'u3', username: 'player1', role: 'PLAYER', status: 'ACTIVE', created_at: '2026-08-03T00:00:00Z' },
  { id: 'u4', username: 'admin', role: 'ORG_ADMIN', status: 'ACTIVE', created_at: '2026-08-04T00:00:00Z' },
];

describe('DashboardJudgesPage', () => {
  it('lists only JUDGE users, hiding players and admins', async () => {
    api.listUsers.mockResolvedValue({ code: 200, data: ALL_USERS });
    renderPage();
    // Two judges appear
    await waitFor(() => {
      expect(screen.getByText('judge_alice')).toBeInTheDocument();
      expect(screen.getByText('judge_bob')).toBeInTheDocument();
    });
    // Other roles do NOT appear
    expect(screen.queryByText('player1')).not.toBeInTheDocument();
    expect(screen.queryByText('admin')).not.toBeInTheDocument();
  });

  it('creates a judge via POST /users with role JUDGE and shows credentials', async () => {
    api.listUsers.mockResolvedValue({ code: 200, data: [] });
    api.createUser.mockResolvedValue({ code: 200, data: { id: 'new-id' } });
    renderPage();

    // Open the create form
    fireEvent.click(await screen.findByRole('button', { name: /create judge|创建裁判/i }));

    // Type a username; the password field is pre-filled by generatePassword
    const usernameInput = screen.getByLabelText(/username|用户名/i);
    fireEvent.change(usernameInput, { target: { value: 'new_judge' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /create account|创建账号/i }));

    await waitFor(() => {
      expect(api.createUser).toHaveBeenCalledWith({
        username: 'new_judge',
        password: expect.any(String),
        role: 'JUDGE',
      });
    });

    // Credentials banner appears with the submitted username
    await waitFor(() => {
      expect(screen.getByText(/Judge created|裁判已创建/i)).toBeInTheDocument();
      expect(screen.getByText('new_judge')).toBeInTheDocument();
    });
  });

  it('surfaces a server error on failed creation and does NOT show the credentials banner', async () => {
    api.listUsers.mockResolvedValue({ code: 200, data: [] });
    api.createUser.mockResolvedValue({ code: 40003, message: 'Username already exists' });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /create judge|创建裁判/i }));
    fireEvent.change(screen.getByLabelText(/username|用户名/i), { target: { value: 'duplicate' } });
    fireEvent.click(screen.getByRole('button', { name: /create account|创建账号/i }));

    await waitFor(() => {
      expect(screen.getByText('Username already exists')).toBeInTheDocument();
    });
    // No green banner — the create failed
    expect(screen.queryByText(/Judge created|裁判已创建/i)).not.toBeInTheDocument();
  });

  it('toggles judge status via updateUserStatus', async () => {
    api.listUsers.mockResolvedValue({ code: 200, data: ALL_USERS });
    api.updateUserStatus.mockResolvedValue({ code: 200 });
    renderPage();

    await screen.findByText('judge_alice');
    // The ACTIVE judge shows the "Deactivate" button
    const deactivateBtns = screen.getAllByRole('button', { name: /deactivate|停用/i });
    fireEvent.click(deactivateBtns[0]);

    await waitFor(() => {
      expect(api.updateUserStatus).toHaveBeenCalledWith('u1', 'INACTIVE');
    });
  });
});
