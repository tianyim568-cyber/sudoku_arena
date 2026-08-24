import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

// Dashboard "Users" page — was "Judges" only until 2026-08-25, now also
// handles ORG_ADMIN creation to close ISSUE-012 ("no UI for single-user
// creation"). The file name and the /dashboard/judges route stay for
// backward compat (bookmarks, existing nav links); the on-screen title
// switched to "Users" with a two-tab picker.
//
// What this covers of the plan: "Judge creation with credential
// generation" (development_plan_v2.md line 490, MVP acceptance
// criterion) AND the ORG_ADMIN case that used to require Excel or seed
// data. Both go through `POST /api/users`, which already accepts every
// role and auto-scopes to the caller's organization on the server. No
// server change needed for ISSUE-012.
//
// PLAYER creation stays out of scope — bulk PLAYER creation is what
// the participant Excel import is for, and single PLAYERs would need a
// competition_id anyway (they belong to a competition, not the org
// directly).
//
// The listing filters client-side because `GET /users` returns every
// role of the caller's org. A server filter would be nicer but is out
// of scope for this page whose whole point is UI convenience.
//
// Credentials display: after a successful create, the generated
// username + password are shown ONCE in a green banner with a copy
// button. Refreshing the page loses them — the password is bcrypt-
// hashed server-side and cannot be recovered. Same pattern as the
// participant export flow.

// Random 8-char alphanumeric password — same shape the participant
// import auto-generates. Not cryptographically strong on its own, but
// hashed with bcrypt on the server and only used once per user.
function generatePassword(length = 8) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

// Roles this page manages. SUPER_ADMIN is out — a super admin is
// provisioned by the platform, not by an org admin. PLAYER too, as
// explained in the header.
const MANAGED_ROLES = ['JUDGE', 'ORG_ADMIN'];

export default function DashboardJudgesPage() {
  const { t } = useLanguage();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // Which role's list is currently shown. Defaults to JUDGE — that's
  // the original use case for this page and the most common.
  const [activeTab, setActiveTab] = useState('JUDGE');
  // Create form state.
  const [showCreate, setShowCreate] = useState(false);
  const [createRole, setCreateRole] = useState('JUDGE');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [justCreated, setJustCreated] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.listUsers();
    if (res.code === 200) {
      setUsers((res.data || []).filter(u => MANAGED_ROLES.includes(u.role)));
      setLoadError(null);
    } else {
      setLoadError(res.message || t('judges.loadFailed'));
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  // Counts per managed role, computed once per users change so the tab
  // labels can show a live badge.
  const countsByRole = useMemo(() => {
    const acc = { JUDGE: 0, ORG_ADMIN: 0 };
    for (const u of users) {
      if (u.role in acc) acc[u.role] += 1;
    }
    return acc;
  }, [users]);

  const visible = users.filter(u => u.role === activeTab);

  // When the admin opens the create form, pre-select the role that
  // matches the tab they were looking at — matches the intent.
  const openCreate = () => {
    setCreateRole(activeTab);
    setUsername('');
    setPassword(generatePassword());
    setCreateError(null);
    setShowCreate(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    if (!MANAGED_ROLES.includes(createRole)) return;
    setCreating(true);
    setCreateError(null);
    const res = await api.createUser({
      username: username.trim(),
      password: password.trim(),
      role: createRole,
    });
    setCreating(false);
    if (res.code === 200) {
      // Keep credentials visible for hand-off — the password is
      // unrecoverable once this banner is dismissed.
      setJustCreated({
        username: username.trim(),
        password: password.trim(),
        role: createRole,
      });
      setUsername('');
      setPassword(generatePassword());
      setShowCreate(false);
      // Switch the visible tab to the newly-created role so the admin
      // sees the fresh row immediately.
      setActiveTab(createRole);
      load();
    } else {
      setCreateError(res.message || t('judges.createFailed'));
    }
  };

  const handleToggleStatus = async (user) => {
    const nextStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const res = await api.updateUserStatus(user.id, nextStatus);
    if (res.code === 200) {
      load();
    } else {
      alert(res.message || t('judges.statusFailed'));
    }
  };

  const copyCredentials = () => {
    if (!justCreated) return;
    const text = `${justCreated.username} / ${justCreated.password}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">{t('judges.title')}</h2>
          <p className="text-sm text-gray-400 mt-1">{t('judges.subtitle')}</p>
        </div>
        <button
          onClick={() => showCreate ? setShowCreate(false) : openCreate()}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-sm font-medium"
        >
          {showCreate ? t('common.cancel') : t('judges.createButton')}
        </button>
      </div>

      {/* Tab picker — switches which role is listed AND pre-selects
          the create form's role when opened next. */}
      <div className="flex gap-2 border-b border-gray-700">
        {MANAGED_ROLES.map(role => {
          const isActive = role === activeTab;
          return (
            <button
              key={role}
              type="button"
              onClick={() => setActiveTab(role)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-indigo-500 text-indigo-300'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              {t(`judges.tabs.${role}`)}
              <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">
                {countsByRole[role]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Credentials banner — shown once, right after a successful
          create. The org admin must copy them BEFORE dismissing; the
          password is bcrypt-hashed on the server and cannot be shown
          again. */}
      {justCreated && (
        <div className="bg-green-900/40 border border-green-700 rounded-lg p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-green-300 text-sm font-semibold mb-2">
                {t('judges.createdBanner', { role: t(`judges.tabs.${justCreated.role}`) })}
              </p>
              <p className="text-green-200 text-sm">
                <span className="font-mono">{justCreated.username}</span>
                <span className="mx-2 text-green-500">/</span>
                <span className="font-mono">{justCreated.password}</span>
              </p>
              <p className="text-green-400 text-xs mt-2">{t('judges.credentialsHint')}</p>
            </div>
            <div className="flex flex-col gap-2 items-end">
              <button
                onClick={copyCredentials}
                className="px-3 py-1 bg-green-700 hover:bg-green-600 rounded text-white text-xs"
              >
                {t('judges.copyCredentials')}
              </button>
              <button
                onClick={() => setJustCreated(null)}
                className="px-3 py-1 text-green-400 hover:text-green-300 text-xs"
              >
                {t('common.dismiss')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="bg-gray-800 rounded-lg p-4 space-y-3">
          <div>
            <label htmlFor="user-role" className="block text-sm text-gray-300 mb-1">
              {t('judges.roleLabel')}
            </label>
            <select
              id="user-role"
              value={createRole}
              onChange={(e) => setCreateRole(e.target.value)}
              className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500"
            >
              {MANAGED_ROLES.map(role => (
                <option key={role} value={role}>{t(`judges.tabs.${role}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="judge-username" className="block text-sm text-gray-300 mb-1">
              {t('judges.usernameLabel')}
            </label>
            <input
              id="judge-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="off"
              className="w-full bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="judge-password" className="block text-sm text-gray-300 mb-1">
              {t('judges.passwordLabel')}
            </label>
            <div className="flex gap-2">
              <input
                id="judge-password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="off"
                className="flex-1 bg-gray-700 text-white rounded px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <button
                type="button"
                onClick={() => setPassword(generatePassword())}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm"
              >
                {t('judges.regenerate')}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">{t('judges.passwordHint')}</p>
          </div>
          {createError && (
            <p className="text-red-400 text-sm">{createError}</p>
          )}
          <button
            type="submit"
            disabled={creating || !username.trim() || password.length < 6}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded text-white text-sm font-medium"
          >
            {creating ? t('common.loading') : t('judges.createSubmit')}
          </button>
        </form>
      )}

      {/* Users list (filtered by active tab) */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">
          {t(`judges.listTitle.${activeTab}`)} ({visible.length})
        </h3>
        {loading ? (
          <p className="text-gray-500 text-sm text-center py-4">{t('common.loading')}</p>
        ) : loadError ? (
          <p className="text-red-400 text-sm text-center py-4">{loadError}</p>
        ) : visible.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">{t(`judges.empty.${activeTab}`)}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-700">
                  <th className="py-2 px-3">{t('judges.colUsername')}</th>
                  <th className="py-2 px-3">{t('judges.colStatus')}</th>
                  <th className="py-2 px-3 hidden sm:table-cell">{t('judges.colCreated')}</th>
                  <th className="py-2 px-3 text-right">{t('judges.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(u => (
                  <tr key={u.id} className="border-b border-gray-700/50 hover:bg-gray-700/50">
                    <td className="py-2 px-3 text-white font-mono">{u.username}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        u.status === 'ACTIVE'
                          ? 'bg-green-900/40 text-green-300'
                          : 'bg-gray-700 text-gray-400'
                      }`}>
                        {t(`judges.status.${u.status}`)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-400 hidden sm:table-cell text-xs">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => handleToggleStatus(u)}
                        className="px-2 py-1 text-xs border border-gray-600 hover:bg-gray-700 rounded text-gray-300"
                      >
                        {u.status === 'ACTIVE' ? t('judges.deactivate') : t('judges.activate')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
