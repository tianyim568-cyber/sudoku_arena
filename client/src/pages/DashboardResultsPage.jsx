import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

// Dashboard "Results" page — historical rankings for any competition, with
// cross-competition comparison mode and export capabilities.
//
// The admin can review every round's ranking and the final rankings from the
// dashboard without generating a display token. The data comes from the same
// DisplayManager.getRankingSnapshot the big screen uses, so the admin and the
// screen always see the same numbers.
//
// Layout: competition picker (left) + round tabs + ranking table (right).
// On mobile the picker collapses to a <select> and the table scrolls.
//
// Compare mode: the admin picks 2-3 competitions and sees their top-10 final
// rankings side by side, each with a CSS bar chart for quick visual comparison.
// No external charting library — just colored bars scaled to the max score.
//
// Export: CSV (client-side blob download) and PDF (window.print() with
// @media print styles that hide the sidebar and buttons).

export default function DashboardResultsPage() {
  const { isAdmin } = useAuth();
  const { t } = useLanguage();
  const [competitions, setCompetitions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [loadFailed, setLoadFailed] = useState(null);
  const [activeRoundId, setActiveRoundId] = useState(null);
  // Category filter — null means "all categories". Reset to null whenever
  // the competition changes: a categoryId valid for competition A may not
  // exist in competition B, and the server filter would silently return 0 rows.
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);

  // Compare mode state
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState([]);
  const [compareSnapshots, setCompareSnapshots] = useState({});
  const [compareLoading, setCompareLoading] = useState(false);

  // `t` is a language-bound function that changes identity on every language
  // switch. Putting it in an effect's dependency array would trigger a refetch
  // on every ZH ↔ EN toggle — wasteful since the data doesn't change with
  // language. A ref keeps it available for fallback error messages resolved in
  // the CURRENT language without re-triggering the fetch.
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  // Load the competition list once.
  useEffect(() => {
    (async () => {
      const res = await api.listCompetitions();
      if (res.code === 200) {
        setCompetitions(res.data || []);
        // Auto-select the first competition so the page is not empty on
        // first render.
        if (res.data && res.data.length > 0) {
          setSelectedId(res.data[0].id);
        }
      } else {
        setLoadFailed(res.message || tRef.current('results.loadListFailed'));
      }
    })();
  }, []);

  // Fetch the ranking snapshot when the selection OR the category filter
  // changes. A separate effect so the list fetch stays idempotent.
  useEffect(() => {
    if (!selectedId || compareMode) {
      setSnapshot(null);
      return;
    }
    setSnapshot(null);
    setLoadFailed(null);
    (async () => {
      const res = await api.getResults(selectedId, selectedCategoryId);
      if (res.code === 200) {
        setSnapshot(res.data);
        // Auto-select the first round (or the final tab if no rounds exist)
        // so the right panel is never empty.
        const firstRound = res.data?.stages?.flatMap(s => s.rounds || [])?.[0];
        setActiveRoundId(firstRound?.id || '__final__');
      } else {
        setLoadFailed(res.message || tRef.current('results.loadFailed'));
      }
    })();
  }, [selectedId, selectedCategoryId, compareMode]);

  // Fetch snapshots for all selected competitions in compare mode.
  useEffect(() => {
    if (!compareMode || compareIds.length === 0) {
      setCompareSnapshots({});
      return;
    }
    setCompareLoading(true);
    (async () => {
      const results = {};
      await Promise.all(
        compareIds.map(async (id) => {
          const res = await api.getResults(id);
          if (res.code === 200) {
            results[id] = res.data;
          }
        })
      );
      setCompareSnapshots(results);
      setCompareLoading(false);
    })();
  }, [compareMode, compareIds]);

  // Flatten rounds across stages for the tab bar.
  const flatRounds = useMemo(() => {
    if (!snapshot?.stages) return [];
    const out = [];
    for (const stage of snapshot.stages) {
      for (const round of stage.rounds || []) {
        out.push({ ...round, stageType: stage.type, stageOrder: stage.orderNumber });
      }
    }
    return out;
  }, [snapshot]);

  // The active tab's ranking rows.
  const activeRows = useMemo(() => {
    if (!snapshot) return [];
    if (activeRoundId === '__final__') {
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

  // Extract final rankings from a snapshot for compare mode.
  const getFinalRows = (snap) => {
    if (!snap) return [];
    return (snap.finalRankings || []).map(fr => ({
      rank: fr.rank,
      score: fr.score,
      label: fr.entityName || '—',
    }));
  };

  // Toggle a competition in the compare selection (max 3).
  const toggleCompare = (id) => {
    setCompareIds(prev =>
      prev.includes(id)
        ? prev.filter(x => x !== id)
        : prev.length < 3 ? [...prev, id] : prev
    );
  };

  // Export the current active rows as CSV.
  const handleExportCsv = () => {
    if (activeRows.length === 0) return;
    const headers = ['rank', 'name', 'school', 'score'];
    const csvRows = [headers.join(',')];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    for (const r of activeRows) {
      csvRows.push([esc(r.rank), esc(r.label), esc(r.school), esc(r.score)].join(','));
    }
    const blob = new Blob(['﻿' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const compName = competitions.find(c => c.id === selectedId)?.name || 'results';
    a.download = `results-${compName}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
      {/* Header with title + action buttons */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{t('results.title')}</h2>
          <p className="text-sm text-gray-600 mt-1">{t('results.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <button
            onClick={() => {
              setCompareMode(!compareMode);
              setCompareIds([]);
              setCompareSnapshots({});
            }}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              compareMode
                ? 'bg-orange-600 text-white hover:bg-orange-500'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {compareMode ? t('results.exitCompare') : t('results.compareMode')}
          </button>
          {!compareMode && snapshot && activeRows.length > 0 && (
            <>
              <button
                onClick={handleExportCsv}
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white text-sm font-medium transition-colors"
              >
                {t('results.exportCsv')}
              </button>
              <button
                onClick={() => window.print()}
                className="px-3 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white text-sm font-medium transition-colors"
              >
                {t('results.print')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Compare mode ── */}
      {compareMode ? (
        <div className="space-y-4">
          {/* Competition picker for compare mode */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <p className="text-sm font-medium text-gray-700 mb-2">{t('results.selectToCompare')}</p>
            <p className="text-xs text-gray-500 mb-3">{t('results.selectAtLeastTwo')}</p>
            <div className="flex flex-wrap gap-2">
              {competitions.map(c => {
                const selected = compareIds.includes(c.id);
                const disabled = !selected && compareIds.length >= 3;
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleCompare(c.id)}
                    disabled={disabled}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      selected
                        ? 'bg-orange-600 text-white'
                        : disabled
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {selected && '✓ '}{c.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Side-by-side comparison cards */}
          {compareLoading && (
            <p className="text-gray-400 text-sm text-center py-8">{t('results.loading')}</p>
          )}
          {!compareLoading && compareIds.length >= 2 && (
            <div className={`grid gap-4 ${
              compareIds.length === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-3'
            }`}>
              {compareIds.map(id => {
                const comp = competitions.find(c => c.id === id);
                const rows = getFinalRows(compareSnapshots[id]).slice(0, 10);
                const maxScore = Math.max(...rows.map(r => r.score || 0), 1);
                return (
                  <div key={id} className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
                    <h3 className="text-sm font-bold text-gray-900 mb-3">{comp?.name}</h3>
                    {rows.length === 0 ? (
                      <p className="text-gray-400 text-xs text-center py-4">{t('results.noRankings')}</p>
                    ) : (
                      <div className="space-y-2">
                        {rows.map((r, i) => {
                          const pct = ((r.score || 0) / maxScore) * 100;
                          const barColor = i === 0 ? 'bg-yellow-500'
                            : i === 1 ? 'bg-gray-400'
                              : i === 2 ? 'bg-amber-700'
                                : 'bg-indigo-500';
                          return (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-500 w-6 shrink-0">#{r.rank}</span>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs text-gray-900 truncate">{r.label}</div>
                                <div className="h-3 bg-gray-100 rounded-full overflow-hidden mt-0.5">
                                  <div
                                    className={`h-full rounded-full ${barColor}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                              <span className="text-xs font-medium text-gray-700 w-10 text-right shrink-0">
                                {r.score}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* ── Normal mode ── */
        <>
          {/* Competition picker */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('results.selectCompetition')}
            </label>
            <select
              value={selectedId || ''}
              onChange={(e) => {
                setSelectedId(e.target.value);
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

          {/* Category filter */}
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

          {snapshot && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
              {/* Round tabs + final tab */}
              <div className="flex flex-wrap gap-2 mb-4 border-b border-gray-200 pb-2 print:hidden">
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

              {/* Top scores bar chart — visual overview above the table */}
              {activeRows.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">
                    {t('results.topScores')}
                  </h4>
                  <div className="space-y-1.5">
                    {activeRows.slice(0, 10).map((r, i) => {
                      const maxScore = Math.max(...activeRows.map(row => row.score || 0), 1);
                      const pct = ((r.score || 0) / maxScore) * 100;
                      const barColor = i === 0 ? 'bg-yellow-500'
                        : i === 1 ? 'bg-gray-400'
                          : i === 2 ? 'bg-amber-700'
                            : 'bg-indigo-500';
                      return (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-xs font-bold text-gray-500 w-6 shrink-0">#{r.rank}</span>
                          <span className="text-xs text-gray-900 w-28 shrink-0 truncate">{r.label}</span>
                          <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${barColor} transition-all duration-300`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium text-gray-700 w-1 text-right shrink-0">
                            {r.score}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

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
        </>
      )}
    </div>
  );
}
