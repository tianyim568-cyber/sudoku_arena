import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { api } from '../api';

export default function CompetitionListPage() {
  const { user, isAdmin, logout } = useAuth();
  const { t } = useLanguage();
  const [competitions, setCompetitions] = useState([]);
  // loadError is set when listCompetitions fails. Without it, a failed load
  // leaves `competitions` as [] and the page renders the "no competitions"
  // empty state — which misleads the user into thinking their org has no
  // competitions when really the server just failed. The toast is still
  // shown for action feedback, but the list area now distinguishes the two.
  const [loadError, setLoadError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [statusMsg, setStatusMsg] = useState(null);
  const navigate = useNavigate();

  const msg = useCallback((text, type = 'info') => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 4000);
  }, []);

  // See DashboardCompetitionsPage: a failed call must always state a reason.
  const load = useCallback(async () => {
    const res = await api.listCompetitions();
    if (res.code === 200) {
      setCompetitions(res.data);
      setLoadError(null);
    } else {
      setLoadError(res.message || t('competitionList.loadFailed', { msg: res.message || res.code }));
      msg(t('competitionList.loadFailed', { msg: res.message || res.code }), 'error');
    }
  }, [t, msg]);

  const handleDelete = async (e, competitionId, competitionName) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(t('competitionList.confirmDelete', { name: competitionName }))) return;
    const res = await api.deleteCompetition(competitionId);
    if (res.code === 200) {
      msg(t('competitionList.deleted', { name: competitionName }));
      load();
    } else {
      msg(res.message || t('competitionList.deleteFailed'), 'error');
    }
  };

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    const res = await api.createCompetition({ name, description });
    if (res.code === 200) {
      setShowCreate(false);
      setName('');
      setDescription('');
      load();
    } else {
      msg(t('competitionList.createFailed', { msg: res.message || res.code }), 'error');
    }
  };

  // See DashboardCompetitionsPage: these are the statuses the server writes.
  const statusColor = {
    DRAFT: 'bg-yellow-100 text-yellow-800',
    PUBLISHED: 'bg-blue-100 text-blue-800',
    RUNNING: 'bg-green-100 text-green-800',
    FINISHED: 'bg-gray-100 text-gray-800',
  };

  const statusLabel = {
    DRAFT: t('common.status.DRAFT'),
    PUBLISHED: t('common.status.PUBLISHED'),
    RUNNING: t('common.status.RUNNING'),
    FINISHED: t('common.status.FINISHED'),
  };

  const isDeletable = (status) => status === 'DRAFT' || status === 'PUBLISHED' || status === 'FINISHED';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-700 to-purple-700 text-white px-4 sm:px-6 py-4 shadow-lg">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold">{t('competitionList.appTitle')}</h1>
            <p className="text-purple-200 text-xs sm:text-sm">{user?.username} ({user?.role})</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <LanguageSwitcher />
            {isAdmin && (
              <button onClick={() => navigate('/puzzle-bank')}
                className="px-3 sm:px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs sm:text-sm transition-colors">
                {t('competitionList.puzzleBank')}
              </button>
            )}
            <button onClick={logout} className="px-3 sm:px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs sm:text-sm transition-colors">
              {t('competitionList.logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 sm:p-6">
        {statusMsg && (
          <div className={`mb-4 px-4 py-3 rounded-lg text-xs sm:text-sm ${
            statusMsg.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
            'bg-green-50 text-green-700 border border-green-200'
          }`}>{statusMsg.text}</div>
        )}

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-800">{t('competitionList.listTitle')}</h2>
          {isAdmin && (
            <button onClick={() => setShowCreate(!showCreate)}
              className="px-3 sm:px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors">
              {t('competitionList.newCompetition')}
            </button>
          )}
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="bg-white rounded-xl shadow p-4 sm:p-6 mb-6 space-y-4">
            <input type="text" placeholder={t('competitionList.namePlaceholder')} value={name} onChange={e => setName(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm sm:text-base" required />
            <textarea placeholder={t('competitionList.descPlaceholder')} value={description} onChange={e => setDescription(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm sm:text-base" rows={2} />
            <div className="flex gap-2">
              <button type="submit" className="px-4 sm:px-6 py-2 bg-indigo-600 text-white rounded-lg text-xs sm:text-sm">{t('competitionList.create')}</button>
              <button type="button" onClick={() => setShowCreate(false)} className="px-4 sm:px-6 py-2 bg-gray-200 text-gray-700 rounded-lg text-xs sm:text-sm">{t('common.cancel')}</button>
            </div>
          </form>
        )}

        {loadError ? (
          // A failed load is NOT the same as an empty org. Show the reason
          // inline so the user knows the list is missing because something
          // broke, not because they have no competitions.
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 sm:p-8 text-center">
            <p className="text-red-700 text-sm sm:text-base">{t('competitionList.loadFailed', { msg: loadError })}</p>
            <button onClick={load} className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs sm:text-sm">
              {t('errors.retry')}
            </button>
          </div>
        ) : competitions.length === 0 ? (
          <div className="text-center py-12 sm:py-20 text-gray-400">
            <p className="text-base sm:text-lg">{t('competitionList.empty')}</p>
            {isAdmin && <p className="text-xs sm:text-sm mt-2">{t('competitionList.emptyHint')}</p>}
          </div>
        ) : (
          <div className="grid gap-4">
            {competitions.map(competition => (
              <Link key={competition.id} to={`/competitions/${competition.id}`}
                className="bg-white rounded-xl shadow hover:shadow-md transition-shadow p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 group">
                <div>
                  <h3 className="text-base sm:text-lg font-semibold text-gray-800">{competition.name}</h3>
                  <p className="text-gray-500 text-xs sm:text-sm mt-1">{competition.description || t('competitionList.noDescription')}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColor[competition.status] || 'bg-gray-100 text-gray-600'}`}>
                    {statusLabel[competition.status] || competition.status}
                  </span>
                  {isAdmin && isDeletable(competition.status) && (
                    <button onClick={(e) => handleDelete(e, competition.id, competition.name)}
                      className="sm:opacity-0 sm:group-hover:opacity-100 transition-opacity px-2 py-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded text-xs sm:text-sm"
                      title={t('competitionList.deleteTitle')}>
                      {t('competitionList.delete')}
                    </button>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
