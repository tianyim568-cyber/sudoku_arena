// Unit tests for DashboardJudgesPage.jsx — the file kept its name for
// backward compat but the page now covers BOTH judges and org admins
// (ISSUE-012, 2026-08-25). Two tabs on top; the create form pre-selects
// the tab's role.
//
// Tests use ZH regexes because LanguageProvider defaults to ZH (see
// src/i18n/LanguageContext.jsx).

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';
import DashboardJudgesPage from '../pages/DashboardJudgesPage';
import { api } from '../api';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => ({
  api: {
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUserStatus: vi.fn(),
  },
}));

function renderPage() {
  return render(
    <LanguageProvider>
      <DashboardJudgesPage />
    </LanguageProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// listUsers returns EVERY role for the org — mix in a player, a judge,
// and an admin to prove the client-side filter keeps only the managed
// roles AND the tab picker splits them.
const ALL_USERS = [
  { id: 'u1', username: 'judge_alice', role: 'JUDGE', status: 'ACTIVE', created_at: '2026-08-01T00:00:00Z' },
  { id: 'u2', username: 'judge_bob', role: 'JUDGE', status: 'INACTIVE', created_at: '2026-08-02T00:00:00Z' },
  { id: 'u3', username: 'player1', role: 'PLAYER', status: 'ACTIVE', created_at: '2026-08-03T00:00:00Z' },
  { id: 'u4', username: 'admin_carol', role: 'ORG_ADMIN', status: 'ACTIVE', created_at: '2026-08-04T00:00:00Z' },
];

describe('DashboardJudgesPage (users page, ISSUE-012)', () => {
  it('defaults to the JUDGE tab and hides admins + players from it', async () => {
    api.listUsers.mockResolvedValue({ code: 200, data: ALL_USERS });
    renderPage();
    // Both judges appear on the default tab.
    await waitFor(() => {
      expect(screen.getByText('judge_alice')).toBeInTheDocument();
      expect(screen.getByText('judge_bob')).toBeInTheDocument();
    });
    // The admin lives on the other tab, not on this one.
    expect(screen.queryByText('admin_carol')).not.toBeInTheDocument();
    // Players are never managed here (created via Excel import). They
    // are dropped from the list at load time, so switching tabs cannot
    // reveal them either.
    expect(screen.queryByText('player1')).not.toBeInTheDocument();
  });

  it('switches to the ORG_ADMIN tab and lists only admins', async () => {
    api.listUsers.mockResolvedValue({ code: 200, data: ALL_USERS });
    renderPage();
    await screen.findByText('judge_alice');

    // Click the admins tab. Its label is "机构管理员" in ZH.
    fireEvent.click(screen.getByRole('button', { name: /机构管理员/i }));

    await waitFor(() => {
      expect(screen.getByText('admin_carol')).toBeInTheDocument();
    });
    // Judges are hidden from the admin tab.
    expect(screen.queryByText('judge_alice')).not.toBeInTheDocument();
    expect(screen.queryByText('judge_bob')).not.toBeInTheDocument();
  });

  it('creates a JUDGE by default (JUDGE tab active) and shows credentials', async () => {
    api.listUsers.mockResolvedValue({ code: 200, data: [] });
    api.createUser.mockResolvedValue({ code: 200, data: { id: 'new-id' } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /创建用户/i }));
    fireEvent.change(screen.getByLabelText(/用户名/i), { target: { value: 'new_judge' } });
    fireEvent.click(screen.getByRole('button', { name: /创建账号/i }));

    await waitFor(() => {
      expect(api.createUser).toHaveBeenCalledWith({
        username: 'new_judge',
        password: expect.any(String),
        role: 'JUDGE',
      });
    });
    // Banner appears with the role name interpolated ("裁判已创建").
    await waitFor(() => {
      expect(screen.getByText(/裁判已创建/)).toBeInTheDocument();
      expect(screen.getByText('new_judge')).toBeInTheDocument();
    });
  });

  it('ISSUE-012: creates an ORG_ADMIN when the role select is switched', async () => {
    api.listUsers.mockResolvedValue({ code: 200, data: [] });
    api.createUser.mockResolvedValue({ code: 200, data: { id: 'new-admin-id' } });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /创建用户/i }));

    // Change the role select from JUDGE (default) to ORG_ADMIN.
    const roleSelect = screen.getByLabelText(/角色/i);
    fireEvent.change(roleSelect, { target: { value: 'ORG_ADMIN' } });

    fireEvent.change(screen.getByLabelText(/用户名/i), { target: { value: 'new_admin' } });
    fireEvent.click(screen.getByRole('button', { name: /创建账号/i }));

    await waitFor(() => {
      expect(api.createUser).toHaveBeenCalledWith({
        username: 'new_admin',
        password: expect.any(String),
        role: 'ORG_ADMIN',
      });
    });
    // Banner interpolates the admin role name in ZH.
    await waitFor(() => {
      expect(screen.getByText(/机构管理员已创建/)).toBeInTheDocument();
    });
  });

  it('surfaces a server error on failed creation and does NOT show the credentials banner', async () => {
    api.listUsers.mockResolvedValue({ code: 200, data: [] });
    api.createUser.mockResolvedValue({ code: 40003, message: 'Username already exists' });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /创建用户/i }));
    fireEvent.change(screen.getByLabelText(/用户名/i), { target: { value: 'duplicate' } });
    fireEvent.click(screen.getByRole('button', { name: /创建账号/i }));

    await waitFor(() => {
      expect(screen.getByText('Username already exists')).toBeInTheDocument();
    });
    // No green banner — the create failed.
    expect(screen.queryByText(/已创建/)).not.toBeInTheDocument();
  });

  it('toggles user status via updateUserStatus', async () => {
    api.listUsers.mockResolvedValue({ code: 200, data: ALL_USERS });
    api.updateUserStatus.mockResolvedValue({ code: 200 });
    renderPage();

    await screen.findByText('judge_alice');
    // The ACTIVE judge has the "停用" (deactivate) button.
    const deactivateBtns = screen.getAllByRole('button', { name: /^停用$/ });
    fireEvent.click(deactivateBtns[0]);

    await waitFor(() => {
      expect(api.updateUserStatus).toHaveBeenCalledWith('u1', 'INACTIVE');
    });
  });
});
