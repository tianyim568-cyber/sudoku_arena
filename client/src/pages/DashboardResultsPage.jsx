import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

// Dashboard "Results" page — historical rankings for any competition.
//
// The admin can review every round's ranking and the final rankings from the
// dashboard without generating a display token. The data comes from the same
// DisplayManager.getRankingSnapshot the big screen uses, so the admin and the
// screen always see the same numbers.
//
// Layout: competition picker (left) + round tabs + ranking table (right).
// On mobile the picker collapses to a <select> and the table scrolls.
//
// A competition with no rankings yet (DRAFT, or RUNNING before any round
// ended) shows an empty state — the page is reachable for every competition,
// not just finished ones, so the admin can peek at intermediate results.
export default function DashboardResultsPage() {
  const { isAdmin } = useAuth();
  const { t } = useLanguage();
  const [competitions, setCompetitions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [loadFailed, setLoadFailed] = useState(null);
  const [activeRoundId, setActiveRoundId] = useState(null);
  // Category filter — null means "all categories". Reset to null whenever
  // the competition changes: a categoryId that is valid for competition A
  // may not exist in competition B, and the server filter would silently
  // return 0 rows. The admin would stare at an empty table with no clue why.
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);

  // `t` is a language-scoped function that changes identity on every language
  // switch. Putting it in an effect's dep array would re-fetch the data
  // whenever the user toggles ZH ↔ EN, which is wasteful (the data itself
  // does not change with language). We keep it in a ref so the fallback error
  // messages still resolve in the CURRENT language when they fire, without
  // re-triggering the fetch.
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  // Load the competition list once. We only need id + name + status for the
  // picker — the full ranking snapshot is fetched on selection.
  useEffect(() => {
    (async () => {
      const res = await api.listCompetitions();
      if (res.code === 200) {
        setCompetitions(res.data || []);
        // Auto-select the first competition so the page is not empty on first
        // render — the admin lands on a result immediately instead of a
        // blank pane with a "select a competition" prompt.
        if (res.data && res.data.length > 0) {
          setSelectedId(res.data[0].id);
        }
      } else {
        setLoadFailed(res.message || tRef.current('results.loadListFailed'));
      }
    })();
  }, []);

  // Fetch the ranking snapshot when the selection OR the category filter
  // changes. A separate effect (not inlined above) so the list fetch stays
  // idempotent. Both selectedId and selectedCategoryId are dependencies —
  // switching category refetches with the new filter applied.
  useEffect(() => {
    if (!selectedId) {
      setSnapshot(null);
      return;
    }
    setSnapshot(null);
    setLoadFailed(null);
    (async () => {
      const res = await api.getResults(selectedId, selectedCategoryId);
      if (res.code === 200) {
        setSnapshot(res.data);
        // Auto-select the first round (or the final tab if no rounds) so the
        // right pane is not empty.
        const firstRound = res.data?.stages?.flatMap(s => s.rounds || [])?.[0];
        setActiveRoundId(firstRound?.id || '__final__');
      } else {
        setLoadFailed(res.message || tRef.current('results.loadFailed'));
      }
    })();
  }, [selectedId, selectedCategoryId]);

  // Flatten rounds across stages for the tab bar — the admin reads results
  // round by round, stages are just a grouping label in the tab title.
  const flatRounds = useMemo(() => {
    if (!snapshot?.stages) return [];
    const out = [];
    for (const stage of snapshot.stages) {
      for (const round of stage.rounds || []) {
        out.push({
          ...round,
          stageType: stage.type,
          stageOrder: stage.orderNumber,
        });
      }
    }
    return out;
  }, [snapshot]);

  // The active tab's ranking rows. `__final__` is the synthetic tab for the
  // final rankings (one row per stage + category in final_rankings).
  const activeRows = useMemo(() => {
    if (!snapshot) return [];
    if (activeRoundId === '__final__') {
      // Final rankings are per-stage. DisplayManager.getRankingSnapshot joins
      // entity_id against players/teams and returns entityName (+ school/age
      // for players), so we show the real name here — same data the big
      // screen's DisplayFinalRankingView renders. Fall back to a stage label
      // only for the rare row written before that join existed.
      return (snapshot.finalRankings || []).map(fr => ({
        rank: fr.rank,
        score: fr.score,
        label: fr.entityName || t('results.stageLabel', { n: fr.stageId.slice(-4) }),
        school: fr.school || '',
        categoryId: fr.categoryId,
      }));
    }
    const round = flatRounds.find(r => r.id === activeRoundId);
    return (round?.rankings || []).map(r => ({
      rank: r.rank,
      score: r.totalScore,
      label: r.player?.name || t('results.unknownPlayer'),
      school: r.player?.school || '',
      category: r.player?.category?.name || '',
    }));
  }, [snapshot, activeRoundId, flatRounds, t]);

  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">{t('results.notAllowed')}</p>
      </div>
    );
  }

  if (loadFailed && competitions.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">{loadFailed}</p>
      </div>
    );
  }

  if (competitions.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">{t('results.noCompetitions')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900">{t('results.title')}</h2>
        <p className="text-sm text-gray-600 mt-1">{t('results.subtitle')}</p>
      </div>

      {/* Competition picker — a <select> on every screen size. A sidebar
          list would crowd the page on mobile, and the admin usually has
          fewer than a dozen competitions. */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t('results.selectCompetition')}
        </label>
        <select
          value={selectedId || ''}
          onChange={(e) => {
            setSelectedId(e.target.value);
            // Reset the category filter when the competition changes — a
            // categoryId valid for competition A may not exist in B, and
            // the server filter would silently return 0 rows. The admin
            // would stare at an empty table with no clue why.
            setSelectedCategoryId(null);
          }}
          className="w-full bg-white text-gray-900 rounded-lg px-3 py-2 border border-gray-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        >
          {competitions.map(c => (
            <option key={c.id} value={c.id}>
              {c.name} — {t(`common.status.${c.status}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Category filter — only shown when the selected competition has
          categories. A competition with no categories must not display an
          empty dropdown. The list comes from snapshot.categories (already
          returned by the server in every case, filtered or not), so no
          separate fetch is needed. */}
      {snapshot && snapshot.categories && snapshot.categories.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {t('results.filterByCategory')}
          </label>
          <select
            value={selectedCategoryId || ''}
            onChange={(e) => setSelectedCategoryId(e.target.value || null)}
            className="w-full bg-white text-gray-900 rounded-lg px-3 py-2 border border-gray-300 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          >
            <option value="">{t('results.allCategories')}</option>
            {snapshot.categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Round tabs + final tab */}
      {snapshot && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
          <div className="flex flex-wrap gap-2 mb-4 border-b border-gray-200 pb-2">
            {flatRounds.map(r => (
              <button
                key={r.id}
                onClick={() => setActiveRoundId(r.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeRoundId === r.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {t('results.roundTab', { n: r.orderNumber })}
              </button>
            ))}
            <button
              onClick={() => setActiveRoundId('__final__')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeRoundId === '__final__'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {t('results.finalTab')}
            </button>
          </div>

          {/* Ranking table */}
          {activeRows.length === 0 ? (
            <p className="text-gray-600 text-sm text-center py-8">
              {t('results.noRankings')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600 border-b border-gray-200">
                    <th className="py-2 px-3 w-16">{t('results.colRank')}</th>
                    <th className="py-2 px-3">{t('results.colName')}</th>
                    <th className="py-2 px-3 hidden sm:table-cell">{t('results.colSchool')}</th>
                    <th className="py-2 px-3 hidden sm:table-cell">{t('results.colCategory')}</th>
                    <th className="py-2 px-3 text-right">{t('results.colScore')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 font-bold text-yellow-600">#{row.rank}</td>
                      <td className="py-2 px-3 text-gray-900">{row.label}</td>
                      <td className="py-2 px-3 text-gray-600 hidden sm:table-cell">{row.school || '—'}</td>
                      <td className="py-2 px-3 text-gray-600 hidden sm:table-cell">{row.category || '—'}</td>
                      <td className="py-2 px-3 text-right text-gray-900 font-medium">{row.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
