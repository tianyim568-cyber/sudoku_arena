import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

// Dashboard overview page — stats summary with clickable filters.
// Cards act as filters: click to show only matching competitions, click again
// (or click "total") to reset. List is sorted by creation date (newest first).
export default function DashboardPage() {
  const { t } = useLanguage();
  const [competitions, setCompetitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeFilter, setActiveFilter] = useState(null);

  useEffect(() => {
    const load = async () => {
      const res = await api.listCompetitions();
      if (res.code === 200) {
        setCompetitions(res.data);
        setError(null);
      } else {
        setError(res.message || t('dashboard.loadFailed'));
      }
      setLoading(false);
    };
    load();
  }, [t]);

  // Count competitions by status. The backend uses: DRAFT, PUBLISHED, RUNNING,
  // PAUSED, FINISHED. Group them logically for the dashboard cards:
  // - "in progress" = RUNNING or PAUSED (actively being played)
  // - "upcoming" = DRAFT or PUBLISHED (not yet started)
  // - "finished" = FINISHED (completed)
  const counts = useMemo(() => ({
    total: competitions.length,
    inProgress: competitions.filter(c => c.status === 'RUNNING' || c.status === 'PAUSED').length,
    upcoming: competitions.filter(c => c.status === 'DRAFT' || c.status === 'PUBLISHED').length,
    finished: competitions.filter(c => c.status === 'FINISHED').length,
  }), [competitions]);

  // Filter and sort competitions based on active card.
  const filteredCompetitions = useMemo(() => {
    let filtered = competitions;
    if (activeFilter === 'inProgress') {
      filtered = competitions.filter(c => c.status === 'RUNNING' || c.status === 'PAUSED');
    } else if (activeFilter === 'upcoming') {
      filtered = competitions.filter(c => c.status === 'DRAFT' || c.status === 'PUBLISHED');
    } else if (activeFilter === 'finished') {
      filtered = competitions.filter(c => c.status === 'FINISHED');
    }
    // Sort by creation date (newest first). created_at may be null for old data.
    return filtered.sort((a, b) => {
      if (!a.created_at) return 1;
      if (!b.created_at) return -1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }, [competitions, activeFilter]);

  // Toggle filter: click same card to reset, different card to switch.
  const handleCardClick = (key) => {
    setActiveFilter(prev => prev === key ? null : key);
  };

  // Status badge styling — color-coded by status for quick visual scanning.
  const statusBadge = (status) => {
    const baseClass = "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium";
    const colorMap = {
      DRAFT: "bg-gray-100 text-gray-700",
      PUBLISHED: "bg-blue-100 text-blue-700",
      RUNNING: "bg-green-100 text-green-700",
      PAUSED: "bg-orange-100 text-orange-700",
      FINISHED: "bg-purple-100 text-purple-700",
    };
    return `${baseClass} ${colorMap[status] || "bg-gray-100 text-gray-700"}`;
  };

  // Card styling — active card gets stronger border and shadow.
  const cardStyle = (key, baseColor, activeColor) => {
    const isActive = activeFilter === key;
    return `transition-all duration-200 rounded-xl border-2 p-4 sm:p-5 cursor-pointer select-none ${
      isActive
        ? `${activeColor} shadow-md scale-[1.02]`
        : `${baseColor} hover:shadow-sm hover:scale-[1.01]`
    }`;
  };

  const cards = [
    {
      key: 'total',
      value: counts.total,
      baseColor: 'bg-white border-gray-200 hover:border-gray-300',
      activeColor: 'bg-gray-50 border-gray-500',
      textColor: 'text-gray-900',
    },
    {
      key: 'inProgress',
      value: counts.inProgress,
      baseColor: 'bg-green-50 border-green-200 hover:border-green-300',
      activeColor: 'bg-green-100 border-green-600',
      textColor: 'text-green-700',
    },
    {
      key: 'upcoming',
      value: counts.upcoming,
      baseColor: 'bg-amber-50 border-amber-200 hover:border-amber-300',
      activeColor: 'bg-amber-100 border-amber-600',
      textColor: 'text-amber-700',
    },
    {
      key: 'finished',
      value: counts.finished,
      baseColor: 'bg-purple-50 border-purple-200 hover:border-purple-300',
      activeColor: 'bg-purple-100 border-purple-600',
      textColor: 'text-purple-700',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500 text-sm">{t('dashboard.loading')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <p className="text-red-800 text-sm font-medium">{t('dashboard.loadFailed')}</p>
        <p className="text-red-600 text-xs mt-2">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
          {t('dashboard.overviewTitle')}
        </h2>
        <p className="text-gray-600 text-sm mt-1">{t('dashboard.overviewSubtitle')}</p>
      </div>

      {/* Stat cards — clickable filters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(card => (
          <button
            key={card.key}
            onClick={() => handleCardClick(card.key)}
            className={cardStyle(card.key, card.baseColor, card.activeColor)}
            type="button"
          >
            <p className={`text-3xl sm:text-4xl font-bold ${card.textColor} tabular-nums`}>
              {card.value}
            </p>
            <p className={`text-sm font-medium mt-2 ${card.textColor} opacity-80`}>
              {t(`dashboard.${card.key === 'total' ? 'totalCompetitions' : card.key}`)}
            </p>
          </button>
        ))}
      </div>

      {/* Competition list */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {filteredCompetitions.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-gray-500 text-sm">
              {competitions.length === 0
                ? t('dashboard.noCompetitions')
                : t('dashboard.noFilteredCompetitions')}
            </p>
            {competitions.length === 0 && (
              <Link
                to="/dashboard/competitions"
                className="inline-block mt-4 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
              >
                {t('competitionList.newCompetition')}
              </Link>
            )}
          </div>
        ) : (
          <>
            {/* List header */}
            <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700">
                {activeFilter
                  ? t(`dashboard.${activeFilter}`)
                  : t('competitionList.listTitle')}
                <span className="ml-2 text-gray-500 font-normal">
                  ({filteredCompetitions.length})
                </span>
              </h3>
            </div>
            {/* List items */}
            <ul className="divide-y divide-gray-100">
              {filteredCompetitions.map(competition => (
                <li key={competition.id}>
                  <Link
                    to={`/competitions/${competition.id}`}
                    className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate group-hover:text-indigo-600 transition-colors">
                        {competition.name}
                      </p>
                      {competition.created_at && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          {new Date(competition.created_at).toLocaleDateString(
                            t('common.locale') || 'zh-CN',
                            { year: 'numeric', month: 'short', day: 'numeric' }
                          )}
                        </p>
                      )}
                    </div>
                    <span className={statusBadge(competition.status)}>
                      {t(`common.status.${competition.status}`)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {/* Footer link when more than 10 items */}
            {filteredCompetitions.length > 10 && (
              <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 text-center">
                <Link
                  to="/dashboard/competitions"
                  className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  {t('dashboard.nav.competitions')} →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
