import { useState, useEffect, useMemo } from 'react';
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
        setLoadFailed(res.message || t('results.loadListFailed'));
      }
    })();
  }, []);

  // Fetch the ranking snapshot when the selection changes. A separate effect
  // (not inlined above) so the list fetch stays idempotent.
  useEffect(() => {
    if (!selectedId) {
      setSnapshot(null);
      return;
    }
    setSnapshot(null);
    setLoadFailed(null);
    (async () => {
      const res = await api.getResults(selectedId);
      if (res.code === 200) {
        setSnapshot(res.data);
        // Auto-select the first round (or the final tab if no rounds) so the
        // right pane is not empty.
        const firstRound = res.data?.stages?.flatMap(s => s.rounds || [])?.[0];
        setActiveRoundId(firstRound?.id || '__final__');
      } else {
        setLoadFailed(res.message || t('results.loadFailed'));
      }
    })();
  }, [selectedId]);

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
        <p className="text-gray-400">{t('results.notAllowed')}</p>
      </div>
    );
  }

  if (loadFailed && competitions.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-red-400">{loadFailed}</p>
      </div>
    );
  }

  if (competitions.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-400">{t('results.noCompetitions')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-white">{t('results.title')}</h2>
        <p className="text-sm text-gray-400 mt-1">{t('results.subtitle')}</p>
      </div>

      {/* Competition picker — a <select> on every screen size. A sidebar
          list would crowd the page on mobile, and the admin usually has
          fewer than a dozen competitions. */}
      <div className="bg-gray-800 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          {t('results.selectCompetition')}
        </label>
        <select
          value={selectedId || ''}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 border border-gray-600 focus:outline-none focus:border-indigo-500"
        >
          {competitions.map(c => (
            <option key={c.id} value={c.id}>
              {c.name} — {t(`common.status.${c.status}`)}
            </option>
          ))}
        </select>
      </div>

      {/* Round tabs + final tab */}
      {snapshot && (
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="flex flex-wrap gap-2 mb-4 border-b border-gray-700 pb-2">
            {flatRounds.map(r => (
              <button
                key={r.id}
                onClick={() => setActiveRoundId(r.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeRoundId === r.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
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
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {t('results.finalTab')}
            </button>
          </div>

          {/* Ranking table */}
          {activeRows.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">
              {t('results.noRankings')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="py-2 px-3 w-16">{t('results.colRank')}</th>
                    <th className="py-2 px-3">{t('results.colName')}</th>
                    <th className="py-2 px-3 hidden sm:table-cell">{t('results.colSchool')}</th>
                    <th className="py-2 px-3 hidden sm:table-cell">{t('results.colCategory')}</th>
                    <th className="py-2 px-3 text-right">{t('results.colScore')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-800 hover:bg-gray-700/50">
                      <td className="py-2 px-3 font-bold text-yellow-400">#{row.rank}</td>
                      <td className="py-2 px-3 text-white">{row.label}</td>
                      <td className="py-2 px-3 text-gray-400 hidden sm:table-cell">{row.school || '—'}</td>
                      <td className="py-2 px-3 text-gray-400 hidden sm:table-cell">{row.category || '—'}</td>
                      <td className="py-2 px-3 text-right text-white font-medium">{row.score}</td>
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
