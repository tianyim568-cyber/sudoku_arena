import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

// Super Admin dashboard — platform-wide overview with management capabilities.
//
// Three tabs: Overview (stats), Organizations (list + detail + toggle), Users (filters + actions).
// Management actions: enable/disable org, reset password, change user role/status.

// ─── Modal overlay ───────────────────────────────────────────────────────────
// Minimal modal: centered card over a semi-transparent backdrop. Closes on
// backdrop click. Children render inside the card.
function Modal({ children, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 border border-gray-700 rounded-lg p-5 w-full max-w-sm mx-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ─── Confirm dialog ──────────────────────────────────────────────────────────
// Two-button modal: confirm (destructive / primary) + cancel.
function ConfirmDialog({ message, onConfirm, onCancel, destructive }) {
  return (
    <Modal onClose={onCancel}>
      <p className="text-sm text-gray-200 mb-5">{message}</p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
        >
          {t_global('admin.cancel')}
        </button>
        <button
          onClick={onConfirm}
          className={`px-3 py-1.5 rounded text-sm font-medium ${
            destructive
              ? 'bg-red-600 hover:bg-red-500 text-white'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
          }`}
        >
          {t_global('admin.confirm')}
        </button>
      </div>
    </Modal>
  );
}

// ─── Password display modal ─────────────────────────────────────────────────
// Shows the generated password with a copy button. The password only exists
// in this modal's state — once closed, it is gone.
function PasswordModal({ password, username, onClose, t }) {
  const [copied, setCopied] = useState(false);

  const copyPassword = () => {
    navigator.clipboard.writeText(password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Modal onClose={onClose}>
      <h3 className="text-sm font-semibold text-gray-200 mb-3">
        {t('admin.newPassword')} — {username}
      </h3>
      <div className="bg-gray-900 rounded p-3 font-mono text-sm text-yellow-300 break-all mb-3">
        {password}
      </div>
      <div className="flex justify-end gap-2">
        <button
          onClick={copyPassword}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-sm"
        >
          {copied ? t('admin.passwordCopied') : t('admin.copyPassword')}
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
        >
          {t('admin.close')}
        </button>
      </div>
    </Modal>
  );
}

// ─── Role change modal ────────────────────────────────────────────────────────
// Dropdown to select a new role for the user. Calls PATCH /admin/users/:id.
function RoleModal({ user, onClose, onUpdated, t }) {
  const [role, setRole] = useState(user.role);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (role === user.role) { onClose(); return; }
    setSaving(true);
    const res = await api.updateAdminUser(user.id, { role });
    setSaving(false);
    if (res.code === 200) {
      onUpdated();
      onClose();
    } else {
      alert(res.message || t('admin.roleUpdateFailed'));
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3 className="text-sm font-semibold text-gray-200 mb-3">
        {t('admin.actionChangeRole')} — {user.username}
      </h3>
      <label className="block text-xs text-gray-400 mb-1">{t('admin.roleLabel')}</label>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm mb-4"
      >
        {['SUPER_ADMIN', 'ORG_ADMIN', 'JUDGE', 'PLAYER'].map(r => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
        >
          {t('admin.cancel')}
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded text-sm disabled:opacity-50"
        >
          {t('admin.saveRole')}
        </button>
      </div>
    </Modal>
  );
}

// Global ref for the ConfirmDialog's cancel button text — avoids prop-drilling
// `t` into a component that lives outside the LanguageContext tree.
let t_global = (key) => key;

// ─── Main page ───────────────────────────────────────────────────────────────
export default function AdminDashboardPage() {
  const { t } = useLanguage();
  const { logout } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Keep the global ref in sync so ConfirmDialog can read `t`.
  t_global = t;

  useEffect(() => {
    const load = async () => {
      const res = await api.getAdminOverview();
      if (res.code === 200) {
        setOverview(res.data);
        setError(null);
      } else {
        setError(res.message || t('admin.loadFailed'));
      }
      setLoading(false);
    };
    load();
  }, [t]);

  if (loading) {
    return <div className="text-gray-400 p-4">{t('admin.loading')}</div>;
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto bg-red-900/30 border border-red-700/40 rounded-lg p-6 text-center">
        <p className="text-red-300 text-sm">{t('admin.loadFailed')}</p>
        <p className="text-red-400 text-xs mt-1">{error}</p>
      </div>
    );
  }

  if (!overview) return null;

  const { stats, organizations, competitions } = overview;

  const cards = [
    { key: 'organizations', value: stats.organizations, color: 'bg-indigo-900/40 text-indigo-300 border-indigo-700/40' },
    { key: 'competitionsTotal', value: stats.competitions.total, color: 'bg-purple-900/40 text-purple-300 border-purple-700/40' },
    { key: 'players', value: stats.users.byRole.PLAYER || 0, color: 'bg-green-900/40 text-green-300 border-green-700/40' },
    { key: 'judges', value: stats.users.byRole.JUDGE || 0, color: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/40' },
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700 px-4 sm:px-6 py-3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-bold">{t('admin.appTitle')}</h1>
            <p className="text-xs text-gray-400">{t('admin.subtitle')}</p>
          </div>
          <button
            onClick={logout}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-md text-sm"
          >
            {t('competitionList.logout')}
          </button>
        </div>
        <nav className="flex gap-2">
          {['overview', 'organizations', 'users'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-t-md text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-gray-900 text-white border-b-2 border-indigo-500'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {t(`admin.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6">
        {/* Overview tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {cards.map(card => (
                <div key={card.key} className={`rounded-lg border p-4 ${card.color}`}>
                  <p className="text-2xl sm:text-3xl font-bold">{card.value}</p>
                  <p className="text-xs sm:text-sm mt-1">{t(`admin.${card.key}`)}</p>
                </div>
              ))}
            </div>

            <div className="bg-gray-800 rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-300 mb-3">{t('admin.competitionsByStatus')}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {['DRAFT', 'PUBLISHED', 'RUNNING', 'FINISHED'].map(status => (
                  <div key={status} className="bg-gray-700/50 rounded p-3 text-center">
                    <p className="text-xl font-bold">{stats.competitions.byStatus[status] || 0}</p>
                    <p className="text-xs text-gray-400 mt-1">{t(`common.status.${status}`)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg p-4">
              <h2 className="text-sm font-semibold text-gray-300 mb-3">
                {t('admin.recentCompetitions')}
              </h2>
              {competitions.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">{t('admin.noCompetitions')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-400 border-b border-gray-700">
                        <th className="py-2 px-3">{t('admin.colCompName')}</th>
                        <th className="py-2 px-3 hidden sm:table-cell">{t('admin.colOrgName')}</th>
                        <th className="py-2 px-3">{t('admin.colStatus')}</th>
                        <th className="py-2 px-3 hidden sm:table-cell">{t('admin.colCreated')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {competitions.map(c => (
                        <tr key={c.id} className="border-b border-gray-700/50 hover:bg-gray-700/50">
                          <td className="py-2 px-3 text-white">{c.name}</td>
                          <td className="py-2 px-3 text-gray-300 hidden sm:table-cell">{c.organizationName || '—'}</td>
                          <td className="py-2 px-3">
                            <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">
                              {t(`common.status.${c.status}`)}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-gray-400 hidden sm:table-cell text-xs">
                            {new Date(c.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Organizations tab */}
        {activeTab === 'organizations' && (
          <OrganizationsTab organizations={organizations} t={t} />
        )}

        {/* Users tab */}
        {activeTab === 'users' && (
          <UsersTab organizations={organizations} t={t} />
        )}
      </main>
    </div>
  );
}

// ─── Organizations tab ───────────────────────────────────────────────────────
// List view → click → detail view with users + competitions + toggle button.
function OrganizationsTab({ organizations, t }) {
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [orgDetail, setOrgDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Modal state for org toggle confirmation
  const [confirmToggle, setConfirmToggle] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  const loadOrgDetail = async (orgId) => {
    setLoading(true);
    setError(null);
    const res = await api.getAdminOrganization(orgId);
    if (res.code === 200) {
      setOrgDetail(res.data);
      setSelectedOrg(orgId);
    } else {
      setError(res.message || t('admin.orgLoadFailed'));
    }
    setLoading(false);
  };

  // Toggle org status: ACTIVE ↔ DISABLED
  const doToggleOrg = async () => {
    if (!orgDetail) return;
    const newStatus = orgDetail.org.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    setActionBusy(true);
    const res = await api.updateAdminOrganization(orgDetail.org.id, { status: newStatus });
    setActionBusy(false);
    if (res.code === 200) {
      // Refresh detail
      setOrgDetail(prev => ({
        ...prev,
        org: { ...prev.org, status: newStatus },
      }));
      setConfirmToggle(null);
    } else {
      alert(res.message || t('admin.statusUpdateFailed'));
    }
  };

  if (loading) {
    return <div className="text-gray-400 p-4">{t('admin.loading')}</div>;
  }

  if (error) {
    return (
      <div className="bg-red-900/30 border border-red-700/40 rounded-lg p-6 text-center">
        <p className="text-red-300 text-sm">{error}</p>
      </div>
    );
  }

  // Detail view
  if (selectedOrg && orgDetail) {
    const { org, users, competitions } = orgDetail;
    const isActive = org.status === 'ACTIVE';

    return (
      <div className="space-y-6">
        <button
          onClick={() => setSelectedOrg(null)}
          className="text-indigo-400 hover:text-indigo-300 text-sm flex items-center gap-1"
        >
          &larr; {t('admin.backToOrganizations')}
        </button>

        <div className="bg-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">{t('admin.orgDetailTitle')}</h2>
            <button
              onClick={() => setConfirmToggle(true)}
              disabled={actionBusy}
              className={`px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50 ${
                isActive
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-green-600 hover:bg-green-500 text-white'
              }`}
            >
              {isActive ? t('admin.actionDisable') : t('admin.actionEnable')}
            </button>
          </div>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-400">{t('admin.orgName')}</dt>
              <dd className="text-white font-medium">{org.name}</dd>
            </div>
            <div>
              <dt className="text-gray-400">{t('admin.orgStatus')}</dt>
              <dd>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  isActive ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
                }`}>
                  {org.status}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-gray-400">{t('admin.orgCreated')}</dt>
              <dd className="text-white font-medium">{new Date(org.createdAt).toLocaleDateString()}</dd>
            </div>
          </dl>
        </div>

        {/* Users table */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">
            {t('admin.orgUsers')} ({users.length})
          </h3>
          {users.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">{t('admin.noOrgUsers')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="py-2 px-3">{t('admin.colUsername')}</th>
                    <th className="py-2 px-3">{t('admin.colRole')}</th>
                    <th className="py-2 px-3">{t('admin.colUserStatus')}</th>
                    <th className="py-2 px-3 hidden sm:table-cell">{t('admin.colCreated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b border-gray-700/50 hover:bg-gray-700/50">
                      <td className="py-2 px-3 text-white">{u.username}</td>
                      <td className="py-2 px-3 text-gray-300">{u.role}</td>
                      <td className="py-2 px-3">
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">
                          {u.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-gray-400 hidden sm:table-cell text-xs">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Competitions table */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">
            {t('admin.orgCompetitions')} ({competitions.length})
          </h3>
          {competitions.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">{t('admin.noOrgCompetitions')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="py-2 px-3">{t('admin.colCompName')}</th>
                    <th className="py-2 px-3">{t('admin.colStatus')}</th>
                    <th className="py-2 px-3 hidden sm:table-cell">{t('admin.colCreated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {competitions.map(c => (
                    <tr key={c.id} className="border-b border-gray-700/50 hover:bg-gray-700/50">
                      <td className="py-2 px-3 text-white">{c.name}</td>
                      <td className="py-2 px-3">
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">
                          {t(`common.status.${c.status}`)}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-gray-400 hidden sm:table-cell text-xs">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Confirm toggle modal */}
        {confirmToggle && (
          <ConfirmDialog
            message={isActive ? t('admin.confirmDisableOrg') : t('admin.confirmEnableOrg')}
            onConfirm={doToggleOrg}
            onCancel={() => setConfirmToggle(null)}
            destructive={isActive}
          />
        )}
      </div>
    );
  }

  // List view
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-gray-300 mb-3">
        {t('admin.orgListTitle')} ({organizations.length})
      </h2>
      {organizations.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-4">{t('admin.noOrganizations')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-400 border-b border-gray-700">
                <th className="py-2 px-3">{t('admin.colOrgName')}</th>
                <th className="py-2 px-3">{t('admin.colUserStatus')}</th>
                <th className="py-2 px-3 text-right">{t('admin.colUsers')}</th>
                <th className="py-2 px-3 text-right">{t('admin.colCompetitions')}</th>
                <th className="py-2 px-3 hidden sm:table-cell">{t('admin.colCreated')}</th>
                <th className="py-2 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {organizations.map(o => (
                <tr key={o.id} className="border-b border-gray-700/50 hover:bg-gray-700/50">
                  <td className="py-2 px-3 text-white">{o.name}</td>
                  <td className="py-2 px-3">
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      o.status === 'ACTIVE' ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
                    }`}>
                      {o.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right text-gray-300">{o.userCount}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{o.competitionCount}</td>
                  <td className="py-2 px-3 text-gray-400 hidden sm:table-cell text-xs">
                    {new Date(o.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-2 px-3">
                    <button
                      onClick={() => loadOrgDetail(o.id)}
                      className="text-indigo-400 hover:text-indigo-300 text-xs"
                    >
                      {t('admin.orgDetailTitle')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Users tab ───────────────────────────────────────────────────────────────
// Filterable list with per-row actions: reset password, change role, toggle status.
function UsersTab({ organizations, t }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ role: '', orgId: '', q: '' });

  // Modal state — only one modal open at a time
  const [passwordResult, setPasswordResult] = useState(null); // { password, username }
  const [roleTarget, setRoleTarget] = useState(null); // user object
  const [confirmUserAction, setConfirmUserAction] = useState(null); // { user, action }
  const [actionBusy, setActionBusy] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    const res = await api.listAdminUsers(filters);
    if (res.code === 200) {
      setUsers(res.data.users);
    } else {
      setError(res.message || t('admin.usersLoadFailed'));
    }
    setLoading(false);
  };

  useEffect(() => { loadUsers(); }, [filters, t]);

  // Reset password — confirm first, then call API
  const doResetPassword = async () => {
    if (!confirmUserAction) return;
    setActionBusy(true);
    const res = await api.resetAdminUserPassword(confirmUserAction.user.id);
    setActionBusy(false);
    if (res.code === 200) {
      setPasswordResult({ password: res.data.password, username: confirmUserAction.user.username });
      setConfirmUserAction(null);
    } else {
      alert(res.message || t('admin.passwordResetFailed'));
    }
  };

  // Toggle user status: ACTIVE ↔ DISABLED
  const doToggleUserStatus = async () => {
    if (!confirmUserAction) return;
    const user = confirmUserAction.user;
    const newStatus = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    setActionBusy(true);
    const res = await api.updateAdminUser(user.id, { status: newStatus });
    setActionBusy(false);
    if (res.code === 200) {
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: newStatus } : u));
      setConfirmUserAction(null);
    } else {
      alert(res.message || t('admin.statusUpdateFailed'));
    }
  };

  // Handle role updated from RoleModal
  const handleRoleUpdated = () => {
    loadUsers();
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-gray-800 rounded-lg p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('admin.filterByRole')}</label>
            <select
              value={filters.role}
              onChange={(e) => setFilters({ ...filters, role: e.target.value })}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            >
              <option value="">{t('admin.allRoles')}</option>
              <option value="SUPER_ADMIN">SUPER_ADMIN</option>
              <option value="ORG_ADMIN">ORG_ADMIN</option>
              <option value="JUDGE">JUDGE</option>
              <option value="PLAYER">PLAYER</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('admin.filterByOrg')}</label>
            <select
              value={filters.orgId}
              onChange={(e) => setFilters({ ...filters, orgId: e.target.value })}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            >
              <option value="">{t('admin.allOrgs')}</option>
              {organizations.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">{t('admin.filterByUsername')}</label>
            <input
              type="text"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder={t('admin.filterByUsername')}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Users list */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-300 mb-3">
          {t('admin.usersListTitle')} ({users.length})
        </h2>
        {loading ? (
          <p className="text-gray-500 text-sm text-center py-4">{t('admin.loading')}</p>
        ) : error ? (
          <div className="bg-red-900/30 border border-red-700/40 rounded p-4 text-center">
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        ) : users.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">{t('admin.noUsers')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="py-2 px-3">{t('admin.colUsername')}</th>
                  <th className="py-2 px-3">{t('admin.colRole')}</th>
                  <th className="py-2 px-3 hidden sm:table-cell">{t('admin.colOrg')}</th>
                  <th className="py-2 px-3">{t('admin.colUserStatus')}</th>
                  <th className="py-2 px-3 hidden sm:table-cell">{t('admin.colCreated')}</th>
                  <th className="py-2 px-3 text-right">{t('admin.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b border-gray-700/50 hover:bg-gray-700/50">
                    <td className="py-2 px-3 text-white">{u.username}</td>
                    <td className="py-2 px-3 text-gray-300">
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">{u.role}</span>
                    </td>
                    <td className="py-2 px-3 text-gray-300 hidden sm:table-cell">{u.organizationName || '—'}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        u.status === 'ACTIVE' ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
                      }`}>
                        {u.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-400 hidden sm:table-cell text-xs">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        <button
                          onClick={() => setConfirmUserAction({ user: u, action: 'resetPassword' })}
                          disabled={actionBusy}
                          className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 disabled:opacity-50"
                        >
                          {t('admin.actionResetPassword')}
                        </button>
                        <button
                          onClick={() => setRoleTarget(u)}
                          className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
                        >
                          {t('admin.actionChangeRole')}
                        </button>
                        <button
                          onClick={() => setConfirmUserAction({ user: u, action: 'toggleStatus' })}
                          disabled={actionBusy}
                          className={`text-xs px-2 py-1 rounded disabled:opacity-50 ${
                            u.status === 'ACTIVE'
                              ? 'bg-red-900/50 hover:bg-red-800/60 text-red-300'
                              : 'bg-green-900/50 hover:bg-green-800/60 text-green-300'
                          }`}
                        >
                          {u.status === 'ACTIVE' ? t('admin.actionDisable') : t('admin.actionEnable')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Password result modal */}
      {passwordResult && (
        <PasswordModal
          password={passwordResult.password}
          username={passwordResult.username}
          onClose={() => setPasswordResult(null)}
          t={t}
        />
      )}

      {/* Role change modal */}
      {roleTarget && (
        <RoleModal
          user={roleTarget}
          onClose={() => setRoleTarget(null)}
          onUpdated={handleRoleUpdated}
          t={t}
        />
      )}

      {/* Confirm dialog for password reset or user status toggle */}
      {confirmUserAction && (
        <ConfirmDialog
          message={
            confirmUserAction.action === 'resetPassword'
              ? t('admin.confirmResetPassword').replace('{username}', confirmUserAction.user.username)
              : (confirmUserAction.user.status === 'ACTIVE'
                  ? `${t('admin.confirmDisableUser')} ${confirmUserAction.user.username}?`
                  : `${t('admin.confirmEnableUser')} ${confirmUserAction.user.username}?`)
          }
          onConfirm={confirmUserAction.action === 'resetPassword' ? doResetPassword : doToggleUserStatus}
          onCancel={() => setConfirmUserAction(null)}
          destructive={confirmUserAction.action === 'toggleStatus' && confirmUserAction.user.status === 'ACTIVE'}
        />
      )}
    </div>
  );
}
