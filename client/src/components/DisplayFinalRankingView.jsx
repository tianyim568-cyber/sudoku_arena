/**
 * DisplayFinalRankingView — the big-screen view for the FINAL_RANKING mode.
 *
 * What it shows: the final podium of a competition, large, for a room to read
 * from the back. Not the grid of every round (that is RankingView) — the
 * final standings, sized up. The room has been watching rounds and stages
 * for hours; the ending is what they will remember, so it gets a dedicated
 * screen instead of falling through to the round grid.
 *
 * Data source: data.finalRankings, already present in the snapshot built by
 * DisplayManager.getRankingSnapshot. The server resolves entityName there
 * (jointure on players or teams based on entityType) so the view shows
 * "Lucie (School X)" and not a truncated UUID. If the name is missing —
 * data edge case, or final_rankings row written before the join was added —
 * the view falls back to entityId truncated, same as RankingView used to.
 *
 * Empty state: if finalRankings is absent or empty, the view says so
 * explicitly. A public screen going blank in front of a room at the closing
 * ceremony is the failure mode this view is here to prevent.
 *
 * Big-screen constraints: dark background, large text, medals for the
 * podium — same language as RoundRankingView and RankingView so the room
 * does not see a style break when the judge switches modes. Do not shrink
 * anything without checking the on-screen result first.
 *
 * The labels are Chinese hardcoded, matching the other display views: this
 * is a public page shown in the room, the audience is Chinese-speaking,
 * and the rest of the display page has never been i18n'd.
 *
 * Presentational only — receives the snapshot in props, touches no network.
 * Polling, token, socket: the parent's job, same as RankingView and
 * RoundRankingView.
 */

const PODIUM_LABEL = {
  GOLD: '冠军',
  SILVER: '亚军',
  BRONZE: '季军',
};

// Podium medals — same colors as RoundRankingView so a mode switch does not
// repaint the badges the room is tracking.
function PodiumBadge({ rank }) {
  if (rank === 1) {
    return (
      <span className="inline-flex items-center justify-center w-16 h-16 rounded-full text-3xl font-bold bg-yellow-500 text-gray-900 shadow-lg">
        {rank}
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="inline-flex items-center justify-center w-16 h-16 rounded-full text-3xl font-bold bg-gray-300 text-gray-900 shadow-lg">
        {rank}
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="inline-flex items-center justify-center w-16 h-16 rounded-full text-3xl font-bold bg-amber-700 text-white shadow-lg">
        {rank}
      </span>
    );
  }
  return <span className="text-gray-400 text-3xl font-semibold pl-3">{rank}</span>;
}

// Podium headline — a large label for the top 3 (冠军/亚军/季军), so the
// room sees at a glance which position they are looking at. Ranks 4+ do not
// get a headline — they are listed below in a plain table-like layout.
function podiumHeadline(rank) {
  if (rank === 1) return PODIUM_LABEL.GOLD;
  if (rank === 2) return PODIUM_LABEL.SILVER;
  if (rank === 3) return PODIUM_LABEL.BRONZE;
  return null;
}

// Render one final-rank row. The podium (1-2-3) gets the badge + headline;
// ranks 4+ get a compact row so the view scales to 20 participants without
// overflowing the screen.
function FinalRankRow({ fr }) {
  const headline = podiumHeadline(fr.rank);
  const name = fr.entityName || `ID ${String(fr.entityId || '').slice(0, 8)}`;
  const isPodium = fr.rank <= 3;

  return (
    <div
      key={`${fr.entityId || 'e'}-${fr.rank}`}
      className={`flex items-center px-6 ${isPodium ? 'py-6' : 'py-3'} hover:bg-white/5 transition-colors`}
    >
      {/* Rank */}
      <div className="w-20 flex-shrink-0">
        <PodiumBadge rank={fr.rank} />
      </div>

      {/* Entity info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-3 flex-wrap">
          <div className={`truncate ${isPodium ? 'text-3xl sm:text-4xl' : 'text-2xl'} font-semibold`}>
            {name}
          </div>
          {headline && (
            <span className="text-base text-yellow-400 font-medium">{headline}</span>
          )}
        </div>
        <div className="text-base text-gray-400 truncate mt-1">
          {fr.school && <span>{fr.school}</span>}
          {fr.age != null && (
            <span className="ml-3">{fr.age}岁</span>
          )}
          {fr.entityType === 'TEAM' && (
            <span className="ml-3 text-purple-400">队伍</span>
          )}
        </div>
      </div>

      {/* Score */}
      <div className="flex-shrink-0 ml-6 text-right">
        <span className={`tabular-nums font-bold ${isPodium ? 'text-4xl sm:text-5xl' : 'text-3xl'}`}>
          {fr.score}
        </span>
        <span className="text-base text-gray-500 ml-2">分</span>
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.data — ranking snapshot from GET /display/:token/ranking
 *        (same shape RankingView and RoundRankingView receive). Must contain
 *        `data.finalRankings` — array of { entityId, entityName, entityType,
 *        rank, score, school, age }.
 * @param {Date|null} [props.lastUpdated] — when the snapshot was last refreshed.
 * @param {number} [props.pollIntervalSeconds] — surfaced in the footer.
 * @param {boolean} [props.socketConnected] — surfaced in the footer.
 */
export default function DisplayFinalRankingView({
  data,
  lastUpdated,
  pollIntervalSeconds,
  socketConnected = false,
}) {
  const { competition, finalRankings } = data;
  const rankings = finalRankings || [];

  // Separate the podium from the rest so we can give it more visual weight.
  // Anything past rank 20 would be unreadable from the back of the room —
  // same cap as RoundRankingView.
  const podium = rankings.filter(fr => fr.rank <= 3).slice(0, 3);
  const rest = rankings.filter(fr => fr.rank > 3).slice(0, 17);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-white flex flex-col">
      {/* Header — competition name + "final results" headline. The
          competition name is the primary; the mode label is secondary. */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-300">
              {competition.name}
            </h1>
            <span className="text-gray-500">·</span>
            <h2 className="text-2xl sm:text-3xl font-bold text-yellow-400">
              最终排名
            </h2>
          </div>
          {lastUpdated && (
            <span className="text-gray-400 text-xs">
              更新于 {lastUpdated.toLocaleTimeString('zh-CN')}
            </span>
          )}
        </div>
      </header>

      {/* Body — either the podium, or an honest empty state. */}
      <main className="flex-1 px-6 py-6 max-w-7xl mx-auto w-full">
        {rankings.length === 0 ? (
          // No final rankings written yet. This happens when the competition
          // ended but the final-rankings table has not been populated. The
          // room sees a clear message instead of a blank wall.
          <EmptyState
            title="最终排名尚未生成"
            subtitle="比赛结束后，最终排名将显示在此处"
          />
        ) : (
          <div className="space-y-6">
            {/* Podium — top 3, large, with medals and headlines. */}
            {podium.length > 0 && (
              <div className="bg-white/5 border border-yellow-500/20 rounded-xl overflow-hidden">
                <div className="divide-y divide-white/5">
                  {podium.map(fr => (
                    <FinalRankRow key={`${fr.entityId || 'e'}-${fr.rank}`} fr={fr} />
                  ))}
                </div>
              </div>
            )}

            {/* Remaining ranks — compact, no headline, no medal. */}
            {rest.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className="divide-y divide-white/5">
                  {rest.map(fr => (
                    <FinalRankRow key={`${fr.entityId || 'e'}-${fr.rank}`} fr={fr} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer — same wording as the other display views so the room does
          not see a style break when the judge switches modes. */}
      <footer className="border-t border-white/10 px-6 py-3 text-center text-gray-600 text-xs">
        数独竞技场 — 最终排名
        {socketConnected
          ? <> · 实时连接</>
          : pollIntervalSeconds != null && <> · 每 {pollIntervalSeconds} 秒自动刷新</>}
      </footer>
    </div>
  );
}

// Small inline component for the empty state. Kept private — not exported,
// only this view uses it. Same shape as the one in RoundRankingView so the
// style does not jump between modes.
function EmptyState({ title, subtitle }) {
  return (
    <div className="text-center text-gray-500 py-20">
      <div className="text-6xl mb-4">🏆</div>
      <div className="text-2xl font-semibold text-gray-300">{title}</div>
      {subtitle && <div className="text-base mt-3">{subtitle}</div>}
    </div>
  );
}
