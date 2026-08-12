import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

// Dashboard "Competitions" page — lists tournaments with create/delete.
// Adapted from TournamentListPage.jsx: the header is removed (DashboardLayout
// provides it) and the outer container is dropped (Outlet already wraps us).
// TournamentListPage.jsx is kept as the fallback for the "/" route.
export default function DashboardCompetitionsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [tournaments, setTournaments] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [statusMsg, setStatusMsg] = useState(null);

  const load = async () => {
    const res = await api.listTournaments();
    if (res.code === 200) setTournaments(res.data);
  };

  const msg = (text, type = 'info') => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  const handleDelete = async (e, tournamentId, tournamentName) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(t('tournamentList.confirmDelete', { name: tournamentName }))) return;
    const res = await api.deleteTournament(tournamentId);
    if (res.code === 200) {
      msg(t('tournamentList.deleted', { name: tournamentName }));
      load();
    } else {
      msg(res.message || t('tournamentList.deleteFailed'), 'error');
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    const res = await api.createTournament({ name, description });
    if (res.code === 200) {
      setShowCreate(false);
      setName('');
      setDescription('');
      load();
    }
  };

  const statusColor = {
    PENDING: 'bg-yellow-100 text-yellow-800',
    IN_PROGRESS: 'bg-green-100 text-green-800',
    PAUSED: 'bg-orange-100 text-orange-800',
    FINISHED: 'bg-gray-100 text-gray-800',
  };

  const statusLabel = {
    PENDING: t('common.status.PENDING'),
    IN_PROGRESS: t('common.status.IN_PROGRESS'),
    PAUSED: t('common.status.PAUSED'),
    FINISHED: t('common.status.FINISHED'),
  };

  return (
    <div>
      {statusMsg && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-xs sm:text-sm ${
          statusMsg.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
          'bg-green-50 text-green-700 border border-green-200'
        }`}>{statusMsg.text}</div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-800">{t('tournamentList.listTitle')}</h2>
        {user?.role === 'ADMIN' && (
          <button onClick={() => setShowCreate(!showCreate)}
            className="px-3 sm:px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors">
            {t('tournamentList.newTournament')}
          </button>
        )}
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl shadow p-4 sm:p-6 mb-6 space-y-4">
          <input type="text" placeholder={t('tournamentList.namePlaceholder')} value={name} onChange={e => setName(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm sm:text-base" required />
          <textarea placeholder={t('tournamentList.descPlaceholder')} value={description} onChange={e => setDescription(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm sm:text-base" rows={2} />
          <div className="flex gap-2">
            <button type="submit" className="px-4 sm:px-6 py-2 bg-indigo-600 text-white rounded-lg text-xs sm:text-sm">{t('tournamentList.create')}</button>
            <button type="button" onClick={() => setShowCreate(false)} className="px-4 sm:px-6 py-2 bg-gray-200 text-gray-700 rounded-lg text-xs sm:text-sm">{t('common.cancel')}</button>
          </div>
        </form>
      )}

      {tournaments.length === 0 ? (
        <div className="text-center py-12 sm:py-20 text-gray-400">
          <p className="text-base sm:text-lg">{t('tournamentList.empty')}</p>
          {user?.role === 'ADMIN' && <p className="text-xs sm:text-sm mt-2">{t('tournamentList.emptyHint')}</p>}
        </div>
      ) : (
        <div className="grid gap-4">
          {tournaments.map(tour => (
            <Link key={tour.id} to={`/tournament/${tour.id}`}
              className="bg-white rounded-xl shadow hover:shadow-md transition-shadow p-4 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 group">
              <div>
                <h3 className="text-base sm:text-lg font-semibold text-gray-800">{tour.name}</h3>
                <p className="text-gray-500 text-xs sm:text-sm mt-1">{tour.description || t('tournamentList.noDescription')}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColor[tour.status] || 'bg-gray-100 text-gray-600'}`}>
                  {statusLabel[tour.status] || tour.status}
                </span>
                {user?.role === 'ADMIN' && (tour.status === 'PENDING' || tour.status === 'FINISHED') && (
                  <button onClick={(e) => handleDelete(e, tour.id, tour.name)}
                    className="sm:opacity-0 sm:group-hover:opacity-100 transition-opacity px-2 py-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded text-xs sm:text-sm"
                    title={t('tournamentList.deleteTitle')}>
                    {t('tournamentList.delete')}
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
