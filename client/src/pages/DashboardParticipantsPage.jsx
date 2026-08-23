import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

// Dashboard "Participants" page — global read-only view across every
// competition of the caller's organization.
//
// Why a global view (F32): per-competition management already exists inside
// CompetitionDetailPage (import Excel, delete, export credentials). What was
// missing is a transversal answer to "has X ever taken part in one of my
// competitions?" — an admin who runs several competitions per year needed
// the search + filter view. This page is that view; it does NOT duplicate
// the per-competition actions.
//
// Data flow: api.listAllParticipants({competitionId?, categoryId?, search?})
// hits GET /api/participants; the server filters strictly by
// competitions.organization_id in the WHERE clause. There is no way from the
// client to reach another org's rows — the WHERE is the tenant boundary.
//
// The Category dropdown is derived client-side from the categories actually
// present in the loaded participants (no dedicated /categories endpoint
// exists yet). If nobody has a category set, the dropdown is hidden — no
// empty dropdown on category-less competitions.
//
// The search input is debounced (300ms) to avoid a refetch per keystroke.

const SEARCH_DEBOUNCE_MS = 300;

export default function DashboardParticipantsPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState([]);
  const [competitions, setCompetitions] = useState([]);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchApplied, setSearchApplied] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  // hasEverLoaded — distinguishes "empty org" (no participants at all)
  // from "filter matched nothing" (had rows before filtering). Used only
  // for the empty-state copy.
  const hasEverLoaded = useRef(false);
  const hasAnyRow = useRef(false);

  // Debounce the search input into searchApplied. The effect below reads
  // searchApplied, so refetching happens 300ms after the last keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setSearchApplied(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Load the competitions list once to populate the picker. We only need
  // id + name for the dropdown — the full ranking snapshot is not needed
  // here.
  useEffect(() => {
    (async () => {
      const res = await api.listCompetitions();
      if (res.code === 200) {
        setCompetitions(res.data || []);
      }
    })();
  }, []);

  // Refetch participants on any filter change.
  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    (async () => {
      const filters = {};
      if (selectedCompetitionId) filters.competitionId = selectedCompetitionId;
      if (selectedCategoryId) filters.categoryId = selectedCategoryId;
      if (searchApplied.trim()) filters.search = searchApplied.trim();
      const res = await api.listAllParticipants(filters);
      if (res.code === 200) {
        const data = res.data || [];
        setRows(data);
        hasEverLoaded.current = true;
        if (data.length > 0) hasAnyRow.current = true;
      } else {
        setLoadError(res.message || t('participants.loadFailed'));
      }
      setLoading(false);
    })();
  }, [selectedCompetitionId, selectedCategoryId, searchApplied, t]);

  // Derive the category options from the participants actually loaded.
  // No dedicated /categories endpoint exists — this is the simplest way
  // that stays consistent with what's actually visible.
  const categoryOptions = useMemo(() => {
    const seen = new Map();
    for (const row of rows) {
      if (row.categoryId && row.categoryName && !seen.has(row.categoryId)) {
        seen.set(row.categoryId, row.categoryName);
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [rows]);

  const anyFilterActive = selectedCompetitionId || selectedCategoryId || searchApplied.trim();
  const showEmptyOrg = !loading && !loadError && rows.length === 0 && !anyFilterActive && !hasAnyRow.current;
  const showEmptyFiltered = !loading && !loadError && rows.length === 0 && (anyFilterActive || hasAnyRow.current);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">{t('participants.title')}</h2>
        <p className="text-sm text-gray-400 mt-1">{t('participants.subtitle')}</p>
      </div>

      {/* Filters — three inputs on one row on desktop, stacked on mobile. */}
      <div className="bg-gray-800 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            {t('participants.filterByCompetition')}
          </label>
          <select
            value={selectedCompetitionId || ''}
            onChange={(e) => setSelectedCompetitionId(e.target.value || null)}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500"
          >
            <option value="">{t('participants.filterAllCompetitions')}</option>
            {competitions.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {categoryOptions.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {t('participants.filterByCategory')}
            </label>
            <select
              value={selectedCategoryId || ''}
              onChange={(e) => setSelectedCategoryId(e.target.value || null)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500"
            >
              <option value="">{t('participants.filterAllCategories')}</option>
              {categoryOptions.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="participants-search" className="block text-sm font-medium text-gray-300 mb-1">
            {t('participants.searchLabel')}
          </label>
          <input
            id="participants-search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('participants.searchPlaceholder')}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Count + table */}
      <div className="bg-gray-800 rounded-lg p-4">
        {loading ? (
          <p className="text-gray-500 text-sm text-center py-8">{t('participants.loading')}</p>
        ) : loadError ? (
          <p className="text-red-400 text-sm text-center py-8">{loadError}</p>
        ) : showEmptyOrg ? (
          <p className="text-gray-500 text-sm text-center py-8">{t('participants.emptyOrg')}</p>
        ) : showEmptyFiltered ? (
          <p className="text-gray-500 text-sm text-center py-8">{t('participants.emptyFiltered')}</p>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-3">
              {t('participants.count', { n: rows.length })}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="py-2 px-3">{t('participants.colName')}</th>
                    <th className="py-2 px-3 hidden sm:table-cell">{t('participants.colSchool')}</th>
                    <th className="py-2 px-3 hidden md:table-cell">{t('participants.colAge')}</th>
                    <th className="py-2 px-3 hidden md:table-cell">{t('participants.colCategory')}</th>
                    <th className="py-2 px-3">{t('participants.colCompetition')}</th>
                    <th className="py-2 px-3 hidden lg:table-cell">{t('participants.colCreated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.id} className="border-b border-gray-800 hover:bg-gray-700/50">
                      <td className="py-2 px-3 text-white">{row.name}</td>
                      <td className="py-2 px-3 text-gray-400 hidden sm:table-cell">{row.school || '—'}</td>
                      <td className="py-2 px-3 text-gray-400 hidden md:table-cell">
                        {row.age != null ? row.age : '—'}
                      </td>
                      <td className="py-2 px-3 text-gray-400 hidden md:table-cell">
                        {row.categoryName || '—'}
                      </td>
                      <td className="py-2 px-3">
                        <Link
                          to={`/competitions/${row.competitionId}`}
                          className="text-indigo-400 hover:text-indigo-300 underline"
                        >
                          {row.competitionName}
                        </Link>
                      </td>
                      <td className="py-2 px-3 text-gray-500 text-xs hidden lg:table-cell">
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
