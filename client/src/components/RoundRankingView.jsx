/**
 * RoundRankingView — the big-screen view for the ROUND_RANKING display mode.
 *
 * What it shows: the ranking of ONE round, large, for a room to read from
 * the back. Not the grid of every round (that is RankingView) — one round,
 * sized up.
 *
 * Which round: see utils/selectRoundToFeature.js. The rule, in short — the
 * live round if any, else the most recently finished round. The selection
 * lives outside the component so it can be tested in isolation.
 *
 * Empty state: if no round qualifies (nothing live, nothing finished), or
 * the selected round has zero rankings, the view says so explicitly. A
 * public screen going blank is the failure mode this view is here to
 * prevent — saying "ranking not available yet for Round 2" is honest; a
 * frozen previous round or a black wall is not.
 *
 * Big-screen constraints: fond sombre, gros caractères, médailles pour le
 * podium — same language as RankingView so the room does not see a style
 * break when the judge switches modes. Do not shrink anything without
 * checking the on-screen result first.
 *
 * The labels are Chinese hardcoded, matching RankingView: this is a public
 * page shown in the room, the audience is Chinese-speaking, and the rest
 * of the display page has never been i18n'd.
 *
 * Presentational only — receives the snapshot in props, touches no network.
 * Polling, token, socket: the parent's job, same as RankingView and
 * BroadcastView.
 */
import { selectRoundToFeature } from '../utils/selectRoundToFeature';

const STATUS_BADGE = {
  WAITING: { label: '未开始', color: 'bg-gray-500' },
  IN_PROGRESS: { label: '进行中', color: 'bg-green-500' },
  PAUSED: { label: '已暂停', color: 'bg-yellow-500' },
  FINISHED: { label: '已结束', color: 'bg-blue-500' },
};

const STAGE_STATUS_BADGE = {
  WAITING: { label: '待开始', color: 'text-gray-400' },
  RUNNING: { label: '进行中', color: 'text-green-400' },
  FINISHED: { label: '已结束', color: 'text-blue-400' },
};

// The podium medals — same colors as RankingView so a mode switch does not
// repaint the badges the room is tracking.
function PodiumBadge({ rank }) {
  if (rank === 1) {
    return (
      <span className="inline-flex items-center justify-center w-14 h-14 rounded-full text-2xl font-bold bg-yellow-500 text-gray-900 shadow-lg">
        {rank}
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="inline-flex items-center justify-center w-14 h-14 rounded-full text-2xl font-bold bg-gray-300 text-gray-900 shadow-lg">
        {rank}
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="inline-flex items-center justify-center w-14 h-14 rounded-full text-2xl font-bold bg-amber-700 text-white shadow-lg">
        {rank}
      </span>
    );
  }
  return <span className="text-gray-400 text-2xl font-semibold pl-3">{rank}</span>;
}

// player.category is a single object in the snapshot: players → categories is
// a to-ONE relation (schema: `categories categories?`, via category_id), so
// the server's `category: r.players.categories` is one object, not an array.
// RankingView reads `.name` directly and is correct. We still guard the array
// case defensively — it costs one line, and a to-one relation that ever became
// to-many would otherwise fail silently — but the object branch is the real one.
function categoryLabel(category) {
  if (!category) return null;
  if (Array.isArray(category)) return category[0]?.name || null;
  return category.name || null;
}

/**
 * @param {object} props
 * @param {object} props.data — ranking snapshot from GET /display/:token/ranking
 *        (same shape RankingView receives).
 * @param {Date|null} [props.lastUpdated] — when the snapshot was last refreshed.
 * @param {number} [props.pollIntervalSeconds] — surfaced in the footer.
 * @param {boolean} [props.socketConnected] — surfaced in the footer.
 */
export default function RoundRankingView({
  data,
  lastUpdated,
  pollIntervalSeconds,
  socketConnected = false,
}) {
  const { competition, stages } = data;
  const selected = selectRoundToFeature(stages);
  const roundStatusBadge = selected
    ? STATUS_BADGE[selected.round.status] || STATUS_BADGE.WAITING
    : null;
  const stageStatusBadge = selected
    ? STAGE_STATUS_BADGE[selected.stage.status]
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-white flex flex-col">
      {/* Header — competition name, round name, status badges. The round
          name is the headline; the competition name is secondary. */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-300">
              {competition.name}
            </h1>
            {selected ? (
              <>
                <span className="text-gray-500">·</span>
                <h2 className="text-2xl sm:text-3xl font-bold">
                  {selected.round.name}
                </h2>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold text-white ${roundStatusBadge.color}`}>
                  {roundStatusBadge.label}
                </span>
                {stageStatusBadge && (
                  <span className={`text-xs font-medium ${stageStatusBadge.color}`}>
                    阶段 {selected.stage.orderNumber} · {stageStatusBadge.label}
                  </span>
                )}
              </>
            ) : null}
          </div>
          {lastUpdated && (
            <span className="text-gray-400 text-xs">
              更新于 {lastUpdated.toLocaleTimeString('zh-CN')}
            </span>
          )}
        </div>
      </header>

      {/* Body — either the ranking, or an honest empty state. */}
      <main className="flex-1 px-6 py-6 max-w-7xl mx-auto w-full">
        {!selected ? (
          // No round qualifies: nothing live, nothing finished. The room
          // sees a clear message instead of a blank wall.
          <EmptyState
            title="暂无进行中或已结束的轮次"
            subtitle="比赛开始后，本轮排名将显示在此处"
          />
        ) : (selected.round.rankings || []).length === 0 ? (
          // A round is selected, but it has no rankings yet. This happens
          // when the round just started and nobody has submitted, or when
          // the round finished but the server has not computed rankings
          // yet. Either way: name the round, say why it is empty.
          <EmptyState
            title={`「${selected.round.name}」暂无排名数据`}
            subtitle={
              selected.round.status === 'IN_PROGRESS'
                ? '选手提交正确答案后，排名将实时更新'
                : selected.round.status === 'PAUSED'
                  ? '轮次暂停中，已提交的排名如下'
                  : '轮次结束后将显示最终排名'
            }
          />
        ) : (
          // The ranking itself. One row per participant, large, with a
          // medal for the podium and a plain number for the rest. We show
          // up to 20 rows — beyond that the screen gets unreadable from
          // the back of the room; the display page is not a full ledger.
          <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
            <div className="divide-y divide-white/5">
              {selected.round.rankings.slice(0, 20).map((r, idx) => (
                <div
                  key={`${r.player?.id || 'p'}-${idx}`}
                  className="flex items-center px-6 py-4 hover:bg-white/5 transition-colors"
                >
                  {/* Rank */}
                  <div className="w-16 flex-shrink-0">
                    <PodiumBadge rank={r.rank} />
                  </div>

                  {/* Player info */}
                  <div className="flex-1 min-w-0">
                    <div className="text-2xl sm:text-3xl font-semibold truncate">
                      {r.player?.name || '—'}
                    </div>
                    <div className="text-base text-gray-400 truncate mt-1">
                      {r.player?.school && <span>{r.player.school}</span>}
                      {r.player?.age != null && (
                        <span className="ml-3">{r.player.age}岁</span>
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
                    <span className="text-3xl sm:text-4xl font-bold tabular-nums">
                      {r.totalScore}
                    </span>
                    <span className="text-base text-gray-500 ml-2">分</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer — same wording as RankingView so the room does not see a
          style break when the judge switches modes. */}
      <footer className="border-t border-white/10 px-6 py-3 text-center text-gray-600 text-xs">
        数独竞技场 — 单轮排名
        {socketConnected
          ? <> · 实时连接</>
          : pollIntervalSeconds != null && <> · 每 {pollIntervalSeconds} 秒自动刷新</>}
      </footer>
    </div>
  );
}

// Small inline component for the empty states. Kept private — not exported,
// only this view uses it.
function EmptyState({ title, subtitle }) {
  return (
    <div className="text-center text-gray-500 py-20">
      <div className="text-6xl mb-4">📊</div>
      <div className="text-2xl font-semibold text-gray-300">{title}</div>
      {subtitle && <div className="text-base mt-3">{subtitle}</div>}
    </div>
  );
}
