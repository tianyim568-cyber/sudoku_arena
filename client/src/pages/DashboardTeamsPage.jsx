import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

// Dashboard "Teams" page — global read-only view across every competition
// of the caller's organization.
//
// Why a global view: per-competition team management (create, add/remove
// members) already exists inside CompetitionDetailPage. What was missing is
// a transversal answer to "which teams exist across all my competitions?"
// This page provides that view without duplicating the per-competition actions.
//
// Data flow: api.listAllTeams({competitionId?, search?}) hits GET /api/teams;
// the server filters by competitions.organization_id in the WHERE clause.
// The client cannot bypass the tenant boundary.
//
// The search input is debounced (300ms) to avoid a refetch per keystroke.

const SEARCH_DEBOUNCE_MS = 300;

export default function DashboardTeamsPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState([]);
  const [competitions, setCompetitions] = useState([]);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // hasEverLoaded distinguishes "empty org" from "filter matched nothing".
  const hasAnyRow = useRef(false);

  // Debounce the search input into searchApplied.
  useEffect(() => {
    const handle = setTimeout(() => setSearchApplied(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Load the competitions list once to populate the picker.
  useEffect(() => {
    (async () => {
      const res = await api.listCompetitions();
      if (res.code === 200) {
        setCompetitions(res.data || []);
      }
    })();
  }, []);

  // Refetch teams on any filter change.
  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    (async () => {
      const filters = {};
      if (selectedCompetitionId) filters.competitionId = selectedCompetitionId;
      if (searchApplied.trim()) filters.search = searchApplied.trim();
      const res = await api.listAllTeams(filters);
      if (res.code === 200) {
        const data = res.data || [];
        setRows(data);
        if (data.length > 0) hasAnyRow.current = true;
      } else {
        setLoadError(res.message || t('dashboardTeams.loadFailed'));
      }
      setLoading(false);
    })();
  }, [selectedCompetitionId, searchApplied, t]);

  const anyFilterActive = selectedCompetitionId || searchApplied.trim();
  const showEmptyOrg = !loading && !loadError && rows.length === 0 && !anyFilterActive && !hasAnyRow.current;
  const showEmptyFiltered = !loading && !loadError && rows.length === 0 && (anyFilterActive || hasAnyRow.current);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{t('dashboardTeams.title')}</h2>
        <p className="text-sm text-gray-500 mt-1">{t('dashboardTeams.subtitle')}</p>
      </div>

      {/* Filters — two inputs on one row on desktop, stacked on mobile. */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('dashboardTeams.filterByCompetition')}
          </label>
          <select
            value={selectedCompetitionId || ''}
            onChange={(e) => setSelectedCompetitionId(e.target.value || null)}
            className="w-full bg-white text-gray-900 rounded-lg px-3 py-2 border border-gray-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">{t('dashboardTeams.filterAllCompetitions')}</option>
            {competitions.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="teams-search" className="block text-sm font-medium text-gray-700 mb-1">
            {t('dashboardTeams.searchLabel')}
          </label>
          <input
            id="teams-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('dashboardTeams.searchPlaceholder')}
            className="w-full bg-white text-gray-900 rounded-lg px-3 py-2 border border-gray-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Count + table */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        {loading ? (
          <p className="text-gray-400 text-sm text-center py-8">{t('dashboardTeams.loading')}</p>
        ) : loadError ? (
          <p className="text-red-600 text-sm text-center py-8">{loadError}</p>
        ) : showEmptyOrg ? (
          <p className="text-gray-400 text-sm text-center py-8">{t('dashboardTeams.emptyOrg')}</p>
        ) : showEmptyFiltered ? (
          <p className="text-gray-400 text-sm text-center py-8">{t('dashboardTeams.emptyFiltered')}</p>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-3">
              {t('dashboardTeams.count', { n: rows.length })}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-200">
                    <th className="py-2 px-3">{t('dashboardTeams.colName')}</th>
                    <th className="py-2 px-3">{t('dashboardTeams.colCompetition')}</th>
                    <th className="py-2 px-3 hidden sm:table-cell">{t('dashboardTeams.colMembers')}</th>
                    <th className="py-2 px-3 hidden lg:table-cell">{t('dashboardTeams.colCreated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 text-gray-900">{row.name}</td>
                      <td className="py-2 px-3">
                        <Link
                          to={`/competitions/${row.competitionId}`}
                          className="text-indigo-600 hover:text-indigo-500 underline"
                        >
                          {row.competitionName}
                        </Link>
                      </td>
                      <td className="py-2 px-3 text-gray-500 hidden sm:table-cell">
                        {row.memberCount ?? '—'}
                      </td>
                      <td className="py-2 px-3 text-gray-400 text-xs hidden lg:table-cell">
                        {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
