/**
 * RankingView — the "leaderboard" view of the big-screen display.
 *
 * Designed for projection in a classroom / auditorium: large text, generous
 * spacing, high contrast, podium medals sized for readability from the back
 * of the room. The RoundRankingView / StageRankingView / FinalRankingView
 * siblings set the visual bar; this view must match it so the room never
 * sees a style break when the judge switches modes.
 *
 * Layout strategy: full-width single-column round cards (not a 2-3 column
 * grid) so each row has room to breathe on a wall screen. The ranking rows
 * inside each card are compact but still large — names at text-xl, scores
 * at text-2xl, medals at w-10 h-10.
 *
 * Presentational only — receives a ranking snapshot (already fetched by
 * DisplayPage) and the selected category. Polling, token verification, and
 * error handling live in the parent.
 *
 * i18n: labels flow through the app's language context; the browser that
 * opened the display token chooses the language. Default is Chinese to
 * match the original audience.
 */
import { useLanguage } from '../i18n/LanguageContext';

// Colors stay hardcoded — they don't translate. Labels are resolved from
// the shared common.status.* keys at render time.
const STATUS_COLOR = {
  PENDING: 'bg-gray-500',
  NOT_STARTED: 'bg-gray-500',
  IN_PROGRESS: 'bg-green-500',
  PAUSED: 'bg-yellow-500',
  FINISHED: 'bg-red-500',
};

const STAGE_STATUS_COLOR = {
  PENDING: 'text-gray-400',
  IN_PROGRESS: 'text-green-400',
  FINISHED: 'text-blue-400',
};

// Podium badge — consistent with RoundRankingView and DisplayFinalRankingView.
function PodiumBadge({ rank, size = 'md' }) {
  const sizes = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-lg',
    lg: 'w-12 h-12 text-xl',
  };
  const s = sizes[size] || sizes.md;

  if (rank === 1) {
    return (
      <span className={`inline-flex items-center justify-center rounded-full font-bold ${s} bg-yellow-500 text-gray-900 shadow-lg`}>
        {rank}
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className={`inline-flex items-center justify-center rounded-full font-bold ${s} bg-gray-300 text-gray-900 shadow-lg`}>
        {rank}
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className={`inline-flex items-center justify-center rounded-full font-bold ${s} bg-amber-700 text-white shadow-lg`}>
        {rank}
      </span>
    );
  }
  return <span className={`text-gray-400 font-semibold ${size === 'lg' ? 'text-2xl' : 'text-xl'} pl-3`}>{rank}</span>;
}

// Category label helper — same guard as RoundRankingView.
function categoryLabel(category) {
  if (!category) return null;
  if (Array.isArray(category)) return category[0]?.name || null;
  return category.name || null;
}

/**
 * @param {object} props
 * @param {object} props.data — ranking snapshot from GET /display/:token/ranking
 * @param {string|null} props.selectedCategoryId — currently selected category tab
 * @param {(id: string|null) => void} props.onSelectCategory — category switcher
 * @param {Date|null} [props.lastUpdated] — when the snapshot was last refreshed
 * @param {number} [props.pollIntervalSeconds] — surfaced in the footer
 * @param {boolean} [props.socketConnected] — surfaced in the footer
 */
export default function RankingView({
  data,
  selectedCategoryId,
  onSelectCategory,
  lastUpdated,
  pollIntervalSeconds,
  socketConnected = false,
}) {
  const { t, lang } = useLanguage();
  const { competition, categories, stages, finalRankings } = data;
  const compStatus = competition.status || 'PENDING';
  const statusColor = STATUS_COLOR[compStatus] || STATUS_COLOR.PENDING;
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-white">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="border-b border-white/10 px-6 py-5">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4 flex-wrap">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              {competition.name}
            </h1>
            <span className={`px-4 py-1.5 rounded-full text-sm font-semibold text-white ${statusColor}`}>
              {t(`common.status.${compStatus}`)}
            </span>
          </div>
          {lastUpdated && (
            <span className="text-gray-400 text-sm">
              {t('display.updatedAt', { time: lastUpdated.toLocaleTimeString(locale) })}
            </span>
          )}
        </div>
      </header>

      {/* ── Category Tabs ──────────────────────────────────────────────── */}
      {categories && categories.length > 0 && (
        <nav className="px-6 pt-5 max-w-7xl mx-auto">
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => onSelectCategory(null)}
              className={`px-5 py-2.5 rounded-lg text-base font-medium transition-colors ${
                selectedCategoryId === null
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                  : 'bg-white/10 text-gray-300 hover:bg-white/20'
              }`}
            >
              {t('display.allCategories')}
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => onSelectCategory(cat.id)}
                className={`px-5 py-2.5 rounded-lg text-base font-medium transition-colors ${
                  selectedCategoryId === cat.id
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                    : 'bg-white/10 text-gray-300 hover:bg-white/20'
                }`}
              >
                {cat.name}
                {cat.min_age != null && cat.max_age != null && (
                  <span className="ml-2 text-xs opacity-70">
                    {t('display.ageRange', { min: cat.min_age, max: cat.max_age })}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* ── Stages & Rounds ────────────────────────────────────────────── */}
      <main className="px-6 py-6 max-w-7xl mx-auto">
        {stages.length === 0 && (
          <div className="text-center text-gray-500 py-20">
            <div className="text-6xl mb-4">📋</div>
            <div className="text-2xl font-semibold text-gray-300">{t('display.emptyStageData')}</div>
          </div>
        )}

        <div className="space-y-10">
          {stages.map(stage => (
            <section key={stage.id}>
              {/* Stage header */}
              <div className="flex items-center gap-4 mb-5">
                <h2 className="text-2xl sm:text-3xl font-bold">
                  {t('display.stageLabel', { n: stage.orderNumber })}
                </h2>
                <span className="text-lg text-gray-400 font-medium">
                  ({stage.type})
                </span>
                {STAGE_STATUS_COLOR[stage.status] && (
                  <span className={`text-sm font-semibold ${STAGE_STATUS_COLOR[stage.status]}`}>
                    {t(`common.status.${stage.status}`)}
                  </span>
                )}
              </div>

              {stage.rounds.length === 0 && (
                <div className="text-gray-500 text-lg pl-4">{t('display.emptyRoundData')}</div>
              )}

              {/* Round cards — full width, one per round, stacked vertically.
                  Each card shows the round name + status in a prominent header,
                  then the ranking rows below. This works better on projection
                  than a multi-column grid because each round gets the full
                  screen width. */}
              <div className="space-y-6">
                {stage.rounds.map(round => (
                  <div
                    key={round.id}
                    className="bg-white/5 border border-white/10 rounded-xl overflow-hidden"
                  >
                    {/* Round header */}
                    <div className="px-6 py-4 border-b border-white/10 bg-white/5 flex items-center justify-between">
                      <h3 className="text-xl sm:text-2xl font-bold">{round.name}</h3>
                      {STAGE_STATUS_COLOR[round.status] && (
                        <span className={`text-sm font-semibold ${STAGE_STATUS_COLOR[round.status]}`}>
                          {t(`common.status.${round.status}`)}
                        </span>
                      )}
                    </div>

                    {/* Ranking rows */}
                    {round.rankings.length === 0 ? (
                      <div className="px-6 py-8 text-center text-gray-500 text-lg">
                        {t('display.emptyRankData')}
                      </div>
                    ) : (
                      <div className="divide-y divide-white/5">
                        {round.rankings.slice(0, 20).map((r, idx) => (
                          <div
                            key={`${r.player?.id || 'p'}-${idx}`}
                            className={`flex items-center px-6 py-4 hover:bg-white/5 transition-colors ${
                              r.rank <= 3 ? 'animate-rank-highlight' : ''
                            }`}
                          >
                            {/* Rank */}
                            <div className="w-14 flex-shrink-0">
                              <PodiumBadge rank={r.rank} />
                            </div>

                            {/* Player info */}
                            <div className="flex-1 min-w-0">
                              <div className="text-xl sm:text-2xl font-semibold truncate">
                                {r.player?.name || '—'}
                              </div>
                              <div className="text-base text-gray-400 truncate mt-0.5">
                                {r.player?.school && <span>{r.player.school}</span>}
                                {r.player?.age != null && (
                                  <span className="ml-3">{t('display.age', { n: r.player.age })}</span>
                                )}
                                {categoryLabel(r.player?.category) && (
                                  <span className="ml-3 text-purple-400">
                                    {categoryLabel(r.player.category)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Score */}
                            <div className="flex-shrink-0 ml-6 text-right">
                              <span className="text-2xl sm:text-3xl font-bold tabular-nums">
                                {r.totalScore}
                              </span>
                              <span className="text-base text-gray-500 ml-2">{t('display.scoreUnit')}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* ── Final Rankings ─────────────────────────────────────────────── */}
        {finalRankings && finalRankings.length > 0 && (
          <section className="mt-12">
            <h2 className="text-2xl sm:text-3xl font-bold mb-5 text-yellow-400">
              {t('display.finalTitle')}
            </h2>
            <div className="bg-white/5 border border-yellow-500/20 rounded-xl overflow-hidden">
              <div className="divide-y divide-white/5">
                {finalRankings.slice(0, 20).map((fr, idx) => {
                  const isPodium = fr.rank <= 3;
                  const name = fr.entityName || `ID ${String(fr.entityId || '').slice(0, 8)}`;

                  return (
                    <div
                      key={`${fr.entityId}-${idx}`}
                      className={`flex items-center px-6 ${isPodium ? 'py-5' : 'py-3'} hover:bg-white/5 transition-colors ${
                        isPodium ? 'animate-rank-highlight' : ''
                      }`}
                    >
                      {/* Rank */}
                      <div className="w-16 flex-shrink-0">
                        <PodiumBadge rank={fr.rank} size={isPodium ? 'lg' : 'md'} />
                      </div>

                      {/* Entity info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-3 flex-wrap">
                          <span className={`truncate font-semibold ${isPodium ? 'text-2xl sm:text-3xl' : 'text-xl'}`}>
                            {name}
                          </span>
                          {fr.entityType === 'TEAM' && (
                            <span className="text-base text-purple-400 font-medium">
                              {t('display.team')}
                            </span>
                          )}
                        </div>
                        {!isPodium && (
                          <div className="text-base text-gray-400 truncate mt-0.5">
                            {fr.school && <span>{fr.school}</span>}
                            {fr.age != null && (
                              <span className="ml-3">{t('display.age', { n: fr.age })}</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Score */}
                      <div className="flex-shrink-0 ml-6 text-right">
                        <span className={`tabular-nums font-bold ${isPodium ? 'text-3xl sm:text-4xl' : 'text-2xl sm:text-3xl'}`}>
                          {fr.score}
                        </span>
                        <span className="text-base text-gray-500 ml-2">{t('display.scoreUnit')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/10 mt-10 px-6 py-4 text-center text-gray-500 text-sm">
        {t('display.footerRankings')}
        {socketConnected
          ? <> · {t('display.live')}</>
          : pollIntervalSeconds != null && <> · {t('display.autoRefresh', { n: pollIntervalSeconds })}</>}
      </footer>
    </div>
  );
}
