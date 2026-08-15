import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

// Dashboard "Competitions" page — lists competitions with create/delete.
// Adapted from CompetitionListPage.jsx: the header is removed (DashboardLayout
// provides it) and the outer container is dropped (Outlet already wraps us).
// CompetitionListPage.jsx is kept as the fallback for the "/" route.
//
// The api calls, local variables, i18n keys and route paths all use the
// "competition" vocabulary. The detail route is PLURAL (/competitions/:id) so
// it cannot collide with the public entry link (/competition/:accessCode).
export default function DashboardCompetitionsPage() {
  const { isAdmin } = useAuth();
  const { t } = useLanguage();
  const [competitions, setCompetitions] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [statusMsg, setStatusMsg] = useState(null);

  const msg = (text, type = 'info') => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  // Every failed call must surface a reason. A silent `if (code === 200)` makes
  // a dead endpoint look like a dead button.
  const load = async () => {
    const res = await api.listCompetitions();
    if (res.code === 200) {
      setCompetitions(res.data);
    } else {
      msg(t('competitionList.loadFailed', { msg: res.message || res.code }), 'error');
    }
  };

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

  useEffect(() => { load(); }, []);

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

  // Competition statuses as the server writes them: DRAFT on creation,
  // RUNNING once started, FINISHED at the end. PUBLISHED is accepted by the
  // engine but nothing sets it yet ("publish competition" is not built).
  // These used to list PENDING / IN_PROGRESS / PAUSED — the pre-UUID names —
  // so every competition rendered as a grey badge showing the raw status.
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

  // A competition can be removed while it is being prepared or once it is
  // over — never while it is running.
  const isDeletable = (status) => status === 'DRAFT' || status === 'PUBLISHED' || status === 'FINISHED';

  return (
    <div>
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

      {competitions.length === 0 ? (
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
    </div>
  );
}
