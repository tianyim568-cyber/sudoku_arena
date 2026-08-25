/**
 * RankingView — the "leaderboard" view of the big-screen display.
 *
 * Extracted from DisplayPage so the display page can later host several views
 * (ranking, current round, final podium, etc.) without rewriting the ranking
 * layout each time. Only the ranking view exists today; the others are
 * Sylvain's to spec.
 *
 * This component is presentational: it receives a ranking snapshot (already
 * fetched by DisplayPage) and the selected category, and renders it. Polling,
 * token verification, and error handling live in the parent — this file does
 * not touch the network.
 *
 * Big-screen constraints: the display is read from several meters away, so
 * font sizes, contrast, and rank badges must stay generous. Do not shrink
 * anything without checking the on-screen result first.
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

/**
 * @param {object} props
 * @param {object} props.data — ranking snapshot from GET /display/:token/ranking
 * @param {string|null} props.selectedCategoryId — currently selected category tab
 * @param {(id: string|null) => void} props.onSelectCategory — category switcher
 * @param {Date|null} [props.lastUpdated] — when the snapshot was last refreshed
 *        (shown in the header for the room). Optional; the parent owns polling.
 * @param {number} [props.pollIntervalSeconds] — surfaced in the footer so the
 *        room can see how often the screen refreshes. Optional.
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
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{competition.name}</h1>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold text-white ${statusColor}`}>
              {t(`common.status.${compStatus}`)}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {lastUpdated && (
              <span className="text-gray-400 text-xs">
                {t('display.updatedAt', { time: lastUpdated.toLocaleTimeString(locale) })}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Category Tabs */}
      {categories && categories.length > 0 && (
        <nav className="px-6 pt-4 max-w-7xl mx-auto">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => onSelectCategory(null)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedCategoryId === null
                  ? 'bg-purple-600 text-white'
                  : 'bg-white/10 text-gray-300 hover:bg-white/20'
              }`}
            >
              {t('display.allCategories')}
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => onSelectCategory(cat.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedCategoryId === cat.id
                    ? 'bg-purple-600 text-white'
                    : 'bg-white/10 text-gray-300 hover:bg-white/20'
                }`}
              >
                {cat.name}
                {cat.min_age != null && cat.max_age != null && (
                  <span className="ml-1 text-xs opacity-70">
                    {t('display.ageRange', { min: cat.min_age, max: cat.max_age })}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Stages & Rankings */}
      <main className="px-6 py-6 max-w-7xl mx-auto">
        {stages.length === 0 && (
          <div className="text-center text-gray-500 py-20">
            <div className="text-5xl mb-4">📋</div>
            <div className="text-lg">{t('display.emptyStageData')}</div>
          </div>
        )}

        <div className="space-y-8">
          {stages.map(stage => (
            <section key={stage.id}>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xl font-semibold">
                  {t('display.stageLabel', { n: stage.orderNumber })}
                  <span className="ml-2 text-gray-400 font-normal text-base">
                    ({stage.type})
                  </span>
                </h2>
                {STAGE_STATUS_COLOR[stage.status] && (
                  <span className={`text-xs font-medium ${STAGE_STATUS_COLOR[stage.status]}`}>
                    {t(`common.status.${stage.status}`)}
                  </span>
                )}
              </div>

              {stage.rounds.length === 0 && (
                <div className="text-gray-500 text-sm pl-4">{t('display.emptyRoundData')}</div>
              )}

              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {stage.rounds.map(round => (
                  <div
                    key={round.id}
                    className="bg-white/5 border border-white/10 rounded-xl overflow-hidden"
                  >
                    <div className="px-4 py-3 border-b border-white/10 bg-white/5 flex items-center justify-between">
                      <h3 className="font-semibold text-sm">{round.name}</h3>
                      {STAGE_STATUS_COLOR[round.status] && (
                        <span className={`text-xs ${STAGE_STATUS_COLOR[round.status]}`}>
                          {t(`common.status.${round.status}`)}
                        </span>
                      )}
                    </div>

                    {round.rankings.length === 0 ? (
                      <div className="px-4 py-6 text-center text-gray-500 text-sm">{t('display.emptyRankData')}</div>
                    ) : (
                      <div className="divide-y divide-white/5">
                        {round.rankings.slice(0, 20).map((r, idx) => (
                          <div
                            key={`${r.player.id}-${idx}`}
                            className="flex items-center px-4 py-2.5 hover:bg-white/5 transition-colors"
                          >
                            {/* Rank */}
                            <div className="w-10 flex-shrink-0">
                              {r.rank <= 3 ? (
                                <span
                                  className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                                    r.rank === 1
                                      ? 'bg-yellow-500 text-gray-900'
                                      : r.rank === 2
                                      ? 'bg-gray-300 text-gray-900'
                                      : 'bg-amber-700 text-white'
                                  }`}
                                >
                                  {r.rank}
                                </span>
                              ) : (
                                <span className="text-gray-400 text-sm pl-2">{r.rank}</span>
                              )}
                            </div>

                            {/* Player info */}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{r.player.name}</div>
                              <div className="text-xs text-gray-400 truncate">
                                {r.player.school && <span>{r.player.school}</span>}
                                {r.player.age != null && <span className="ml-2">{t('display.age', { n: r.player.age })}</span>}
                                {r.player.category && (
                                  <span className="ml-2 text-purple-400">{r.player.category.name}</span>
                                )}
                              </div>
                            </div>

                            {/* Score */}
                            <div className="flex-shrink-0 ml-3">
                              <span className="text-lg font-bold tabular-nums">
                                {r.totalScore}
                              </span>
                              <span className="text-xs text-gray-500 ml-1">{t('display.scoreUnit')}</span>
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

        {/* Final Rankings */}
        {finalRankings && finalRankings.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold mb-4">{t('display.finalTitle')}</h2>
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <div className="divide-y divide-white/5">
                {finalRankings.map((fr, idx) => (
                  <div key={`${fr.entityId}-${idx}`} className="flex items-center px-6 py-3">
                    <div className="w-12 flex-shrink-0">
                      {fr.rank <= 3 ? (
                        <span
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                            fr.rank === 1
                              ? 'bg-yellow-500 text-gray-900'
                              : fr.rank === 2
                              ? 'bg-gray-300 text-gray-900'
                              : 'bg-amber-700 text-white'
                          }`}
                        >
                          {fr.rank}
                        </span>
                      ) : (
                        <span className="text-gray-400 pl-2">{fr.rank}</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <span className="text-sm font-medium">{fr.entityType}</span>
                      <span className="text-xs text-gray-400 ml-2">{fr.entityId?.slice(0, 8)}...</span>
                    </div>
                    <div className="text-lg font-bold tabular-nums">{fr.score}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Footer — the refresh cadence is informational for the room. Kept
          inside the view so the gradient covers the whole screen; future
          views may carry their own footer. */}
      {/* The footer states how the page stays fresh. Once the display socket
          is connected, the refresh cadence is no longer the truth — saying
          "refreshes every 10s" while updates arrive instantly would be a
          small lie on a screen the whole room is reading. */}
      <footer className="border-t border-white/10 mt-8 px-6 py-3 text-center text-gray-600 text-xs">
        {t('display.footerRankings')}
        {socketConnected
          ? <> · {t('display.live')}</>
          : pollIntervalSeconds != null && <> · {t('display.autoRefresh', { n: pollIntervalSeconds })}</>}
      </footer>
    </div>
  );
}
