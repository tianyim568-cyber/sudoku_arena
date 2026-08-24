import { useState, useEffect } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

// Dashboard "Judges" page — replaces the ComingSoonPage placeholder.
//
// What this covers of the plan: "Judge creation with credential generation"
// (development_plan_v2.md line 490, MVP acceptance criterion). Not the
// route split debated in ISSUE-027 (POST /competitions/:id/judges is
// ASSIGNMENT, and the plan wants CREATION to sit on the same verb+path) —
// we sidestep the collision by going through `POST /api/users` with
// `role: 'JUDGE'`, which already exists, already accepts the JUDGE role,
// and already auto-scopes to the caller's organization on the server.
// If Sylvain later reworks the /judges route to also handle creation,
// this page's create call is the ONLY thing to swap.
//
// The listing filters client-side because `GET /users` returns the org's
// users of every role. A judge-only server filter would be nicer but is
// out of scope for a page whose whole point is to close the "no judge
// creation UI" gap without touching Sylvain's routes.
//
// Credentials display: after a successful create, the generated
// username + password are shown ONCE in a green banner with a copy
// button. Refreshing the page loses them — the password is bcrypt-hashed
// server-side and cannot be recovered. This mirrors the participant
// export flow: the org admin's job is to hand the credentials to the
// judge before the banner disappears.

// Random 8-char alphanumeric password — same shape the participant
// import auto-generates. Not cryptographically strong on its own, but
// hashed with bcrypt on the server and only used once per judge.
function generatePassword(length = 8) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export default function DashboardJudgesPage() {
  const { t } = useLanguage();
  const [judges, setJudges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [justCreated, setJustCreated] = useState(null);

  const load = async () => {
    setLoading(true);
    const res = await api.listUsers();
    if (res.code === 200) {
      // Server returns every role — we only surface JUDGE here. Ordering
      // by created_at DESC already happens on the server side.
      setJudges((res.data || []).filter(u => u.role === 'JUDGE'));
      setLoadError(null);
    } else {
      setLoadError(res.message || t('judges.loadFailed'));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setCreating(true);
    setCreateError(null);
    const res = await api.createUser({
      username: username.trim(),
      password: password.trim(),
      role: 'JUDGE',
    });
    setCreating(false);
    if (res.code === 200) {
      // Keep the credentials visible for the admin to hand off — the
      // password is unrecoverable once this banner is dismissed.
      setJustCreated({ username: username.trim(), password: password.trim() });
      setUsername('');
      setPassword(generatePassword());
      setShowCreate(false);
      load();
    } else {
      setCreateError(res.message || t('judges.createFailed'));
    }
  };

  const handleToggleStatus = async (judge) => {
    const nextStatus = judge.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const res = await api.updateUserStatus(judge.id, nextStatus);
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
          onClick={() => { setShowCreate(!showCreate); setCreateError(null); }}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-sm font-medium"
        >
          {showCreate ? t('common.cancel') : t('judges.createButton')}
        </button>
      </div>

      {/* Credentials banner — shown once, right after a successful create.
          The org admin must copy them BEFORE dismissing; the password is
          bcrypt-hashed on the server and cannot be shown again. */}
      {justCreated && (
        <div className="bg-green-900/40 border border-green-700 rounded-lg p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-green-300 text-sm font-semibold mb-2">
                {t('judges.createdBanner')}
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

      {/* Judges list */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">
          {t('judges.listTitle')} ({judges.length})
        </h3>
        {loading ? (
          <p className="text-gray-500 text-sm text-center py-4">{t('common.loading')}</p>
        ) : loadError ? (
          <p className="text-red-400 text-sm text-center py-4">{loadError}</p>
        ) : judges.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">{t('judges.empty')}</p>
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
                {judges.map(j => (
                  <tr key={j.id} className="border-b border-gray-700/50 hover:bg-gray-700/50">
                    <td className="py-2 px-3 text-white font-mono">{j.username}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        j.status === 'ACTIVE'
                          ? 'bg-green-900/40 text-green-300'
                          : 'bg-gray-700 text-gray-400'
                      }`}>
                        {t(`judges.status.${j.status}`)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-400 hidden sm:table-cell text-xs">
                      {new Date(j.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => handleToggleStatus(j)}
                        className="px-2 py-1 text-xs border border-gray-600 hover:bg-gray-700 rounded text-gray-300"
                      >
                        {j.status === 'ACTIVE' ? t('judges.deactivate') : t('judges.activate')}
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
