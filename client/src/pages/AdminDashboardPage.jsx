import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

// Super Admin dashboard — platform-wide overview.
//
// Replaces /admin-coming-soon (R11). The Super Admin lands here on login and
// sees the platform at a glance: how many organizations, how many
// competitions (and by status), how many users per role. The org list and the
// recent competitions list give them a starting point for any investigation.
//
// Read-only by design. P2 scope does not include creating orgs, disabling
// orgs, or resetting passwords — those are platform-mutation operations with
// cross-tenant impact, and they need Sylvain's review before they ship.
//
// The page does not use DashboardLayout — the Super Admin has no org, so the
// sidebar (which is org-scoped) would be empty. A simple top bar with a
// logout button is enough.
export default function AdminDashboardPage() {
  const { t } = useLanguage();
  const { logout } = useAuth();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  if (!overview) {
    return null;
  }

  const { stats, organizations, competitions } = overview;

  // Stat cards: organizations, competitions total, players, judges.
  // byStatus / byRole are maps; we fall back to 0 so a missing key (e.g. no
  // PAUSED competitions yet) does not break the render.
  const cards = [
    { key: 'organizations', value: stats.organizations, color: 'bg-indigo-900/40 text-indigo-300 border-indigo-700/40' },
    { key: 'competitionsTotal', value: stats.competitions.total, color: 'bg-purple-900/40 text-purple-300 border-purple-700/40' },
    { key: 'players', value: stats.users.byRole.PLAYER || 0, color: 'bg-green-900/40 text-green-300 border-green-700/40' },
    { key: 'judges', value: stats.users.byRole.JUDGE || 0, color: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/40' },
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Top bar — Super Admin has no org sidebar, so this is the only nav. */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 sm:px-6 py-3 flex items-center justify-between">
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
      </header>

      <main className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map(card => (
            <div key={card.key} className={`rounded-lg border p-4 ${card.color}`}>
              <p className="text-2xl sm:text-3xl font-bold">{card.value}</p>
              <p className="text-xs sm:text-sm mt-1">{t(`admin.${card.key}`)}</p>
            </div>
          ))}
        </div>

        {/* Competitions by status — the byStatus map has one entry per
            status that actually has competitions, so we iterate over the
            known statuses and fall back to 0. */}
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

        {/* Organizations list */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">
            {t('admin.organizations')} ({organizations.length})
          </h2>
          {organizations.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">{t('admin.noOrganizations')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="py-2 px-3">{t('admin.colOrgName')}</th>
                    <th className="py-2 px-3 text-right">{t('admin.colUsers')}</th>
                    <th className="py-2 px-3 text-right">{t('admin.colCompetitions')}</th>
                    <th className="py-2 px-3 hidden sm:table-cell">{t('admin.colCreated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {organizations.map(o => (
                    <tr key={o.id} className="border-b border-gray-700/50 hover:bg-gray-700/50">
                      <td className="py-2 px-3 text-white">{o.name}</td>
                      <td className="py-2 px-3 text-right text-gray-300">{o.userCount}</td>
                      <td className="py-2 px-3 text-right text-gray-300">{o.competitionCount}</td>
                      <td className="py-2 px-3 text-gray-400 hidden sm:table-cell text-xs">
                        {new Date(o.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent competitions — newest first, capped at 50 by the server */}
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
      </main>
    </div>
  );
}
