import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

// Dashboard overview page — simple stats summary of competitions.
// Data comes from the existing listTournaments() API; we just count by status.
// No advanced features here — just a snapshot of the organization's competitions.
export default function DashboardPage() {
  const { t } = useLanguage();
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const res = await api.listTournaments();
      if (res.code === 200) setTournaments(res.data);
      setLoading(false);
    };
    load();
  }, []);

  if (loading) {
    return <div className="text-gray-500 p-4">{t('dashboard.loading')}</div>;
  }

  // Count competitions by status. PENDING = upcoming, IN_PROGRESS/PAUSED = in progress, FINISHED = finished.
  const counts = {
    total: tournaments.length,
    inProgress: tournaments.filter(t => t.status === 'IN_PROGRESS' || t.status === 'PAUSED').length,
    upcoming: tournaments.filter(t => t.status === 'PENDING').length,
    finished: tournaments.filter(t => t.status === 'FINISHED').length,
  };

  // Stat cards: { key, value, color }.
  const cards = [
    { key: 'totalCompetitions', value: counts.total, color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    { key: 'inProgress', value: counts.inProgress, color: 'bg-green-50 text-green-700 border-green-200' },
    { key: 'upcoming', value: counts.upcoming, color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
    { key: 'finished', value: counts.finished, color: 'bg-gray-50 text-gray-700 border-gray-200' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg sm:text-xl font-semibold text-gray-800">{t('dashboard.overviewTitle')}</h2>
        <p className="text-gray-500 text-xs sm:text-sm mt-1">{t('dashboard.overviewSubtitle')}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(card => (
          <div key={card.key} className={`rounded-xl border p-4 sm:p-5 ${card.color}`}>
            <p className="text-2xl sm:text-3xl font-bold">{card.value}</p>
            <p className="text-xs sm:text-sm mt-1">{t(`dashboard.${card.key}`)}</p>
          </div>
        ))}
      </div>

      {tournaments.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-6 sm:p-8 text-center text-gray-400">
          <p className="text-sm sm:text-base">{t('dashboard.noCompetitions')}</p>
          <Link to="/dashboard/competitions" className="inline-block mt-3 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs sm:text-sm hover:bg-indigo-500 transition-colors">
            {t('tournamentList.newTournament')}
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow p-4 sm:p-6">
          <h3 className="text-sm sm:text-base font-semibold text-gray-700 mb-3">{t('tournamentList.listTitle')}</h3>
          <ul className="divide-y divide-gray-100">
            {tournaments.slice(0, 5).map(tour => (
              <li key={tour.id}>
                <Link to={`/tournament/${tour.id}`} className="flex items-center justify-between py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
                  <span className="text-sm text-gray-700 truncate">{tour.name}</span>
                  <span className="text-xs text-gray-400 ml-3">{t(`common.status.${tour.status}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {tournaments.length > 5 && (
            <Link to="/dashboard/competitions" className="block text-center text-xs text-indigo-600 hover:text-indigo-500 mt-3">
              {t('dashboard.nav.competitions')} →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
