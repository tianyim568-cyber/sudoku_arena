/**
 * DisplayStageRankingView — the big-screen view for the STAGE_RANKING mode.
 *
 * What it shows: the aggregated ranking of ONE stage, large, for a room to
 * read from the back. Not the grid of every round (that is RankingView), not
 * the ranking of one round (that is RoundRankingView), not the final podium
 * (that is DisplayFinalRankingView) — the stage-level standings, sized up.
 *
 * Which stage: see utils/selectStageToFeature.js. The rule, in short — the
 * running stage if any, else the most recently finished stage. The selection
 * lives outside the component so it can be tested in isolation.
 *
 * Data source: data.finalRankings filtered by the selected stage's id. The
 * server's getRankingSnapshot already returns finalRankings rows that carry
 * a stageId (each row is one entity × one stage × one category), so the
 * view filters client-side — no extra fetch. Rows are pre-sorted by rank.
 *
 * Empty states: two layers.
 *   - No stage qualifies (nothing running, nothing finished): the room sees
 *     "no stage" rather than a blank wall.
 *   - A stage qualifies but has zero ranking rows for it yet: the room sees
 *     the stage named, with "ranking not computed yet". This happens when
 *     the stage just started and no round has finished, or when the stage
 *     finished but the server has not written the aggregate rows yet.
 *
 * Big-screen constraints: dark background, large text, medals for the
 * podium — same language as RoundRankingView and DisplayFinalRankingView so
 * the room does not see a style break when the judge switches modes. Do not
 * shrink anything without checking the on-screen result first.
 *
 * The labels are Chinese hardcoded, matching the other display views: this
 * is a public page shown in the room, the audience is Chinese-speaking, and
 * the rest of the display page has never been i18n'd.
 *
 * Presentational only — receives the snapshot in props, touches no network.
 * Polling, token, socket: the parent's job, same as RankingView and the
 * other display views.
 */
import { selectStageToFeature } from '../utils/selectStageToFeature';

// Stage status badge — different shape from the round status badge, since
// stages use RUNNING where rounds use IN_PROGRESS.
const STAGE_STATUS_BADGE = {
  WAITING: { label: '待开始', color: 'bg-gray-500' },
  RUNNING: { label: '进行中', color: 'bg-green-500' },
  FINISHED: { label: '已结束', color: 'bg-blue-500' },
};

const STAGE_TYPE_LABEL = {
  INDIVIDUAL: '个人',
  TEAM: '团队',
};

const PODIUM_LABEL = {
  GOLD: '冠军',
  SILVER: '亚军',
  BRONZE: '季军',
};

// Podium medals — same colors as DisplayFinalRankingView so a mode switch
// does not repaint the badges the room is tracking.
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
// overflowing the screen. This is the same shape as
// DisplayFinalRankingView's FinalRankRow — the data has the same form
// (entityName / entityType / school / age / rank / score), so we reuse the
// layout rather than inventing a new one.
function StageRankRow({ fr }) {
  const headline = podiumHeadline(fr.rank);
  const name = fr.entityName || `ID ${String(fr.entityId || '').slice(0, 8)}`;
  const isPodium = fr.rank <= 3;
  const isTeam = fr.entityType === 'TEAM';

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
          {isTeam && (
            <span className="text-base text-purple-400 font-medium">队伍</span>
          )}
        </div>
        {/* Teams do not carry school/age in the snapshot — the server joins
            on the team row, not the player row. Hide the line for teams so
            the row does not show an empty age gap. */}
        {!isTeam && (
          <div className="text-base text-gray-400 truncate mt-1">
            {fr.school && <span>{fr.school}</span>}
            {fr.age != null && (
              <span className="ml-3">{fr.age}岁</span>
            )}
          </div>
        )}
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
 *        (same shape RoundRankingView / DisplayFinalRankingView receive).
 *        Must contain `data.stages` and `data.finalRankings`.
 * @param {Date|null} [props.lastUpdated] — when the snapshot was last refreshed.
 * @param {number} [props.pollIntervalSeconds] — surfaced in the footer.
 * @param {boolean} [props.socketConnected] — surfaced in the footer.
 */
export default function DisplayStageRankingView({
  data,
  lastUpdated,
  pollIntervalSeconds,
  socketConnected = false,
}) {
  const { competition, stages, finalRankings } = data;
  const selected = selectStageToFeature(stages);
  const statusBadge = selected
    ? STAGE_STATUS_BADGE[selected.status] || STAGE_STATUS_BADGE.WAITING
    : null;

  // Filter finalRankings to the selected stage. The server writes one row
  // per entity × stage × category, so this gives us the stage-level
  // standings (aggregated across the rounds of that stage).
  const stageRankings = selected
    ? (finalRankings || []).filter(fr => fr.stageId === selected.id)
    : [];

  // Cap at 20 rows — beyond that the screen gets unreadable from the back
  // of the room; the display page is not a full ledger. Same cap as the
  // other display views.
  const podium = stageRankings.filter(fr => fr.rank <= 3).slice(0, 3);
  const rest = stageRankings.filter(fr => fr.rank > 3).slice(0, 17);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-white flex flex-col">
      {/* Header — competition name + stage label + status badge. The stage
          label is the headline; the competition name is secondary. */}
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
                  阶段 {selected.orderNumber}
                  <span className="ml-3 text-base font-medium text-gray-400">
                    {STAGE_TYPE_LABEL[selected.type] || selected.type}
                  </span>
                </h2>
                {statusBadge && (
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold text-white ${statusBadge.color}`}>
                    {statusBadge.label}
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
          // No stage qualifies: nothing running, nothing finished. The room
          // sees a clear message instead of a blank wall.
          <EmptyState
            title="暂无进行中或已结束的阶段"
            subtitle="比赛开始后，阶段排名将显示在此处"
          />
        ) : stageRankings.length === 0 ? (
          // A stage is selected, but it has no ranking rows yet. This
          // happens when the stage just started and no round has finished,
          // or when the stage finished but the aggregate has not been
          // written yet. Either way: name the stage, say why it is empty.
          <EmptyState
            title={`「阶段 ${selected.orderNumber}」暂无排名数据`}
            subtitle={
              selected.status === 'RUNNING'
                ? '阶段进行中，轮次结束后将显示综合排名'
                : '阶段结束后将显示综合排名'
            }
          />
        ) : (
          <div className="space-y-6">
            {/* Podium — top 3, large, with medals and headlines. */}
            {podium.length > 0 && (
              <div className="bg-white/5 border border-yellow-500/20 rounded-xl overflow-hidden">
                <div className="divide-y divide-white/5">
                  {podium.map(fr => (
                    <StageRankRow key={`${fr.entityId || 'e'}-${fr.rank}`} fr={fr} />
                  ))}
                </div>
              </div>
            )}

            {/* Remaining ranks — compact, no headline, no medal. */}
            {rest.length > 0 && (
              <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className="divide-y divide-white/5">
                  {rest.map(fr => (
                    <StageRankRow key={`${fr.entityId || 'e'}-${fr.rank}`} fr={fr} />
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
        数独竞技场 — 阶段排名
        {socketConnected
          ? <> · 实时连接</>
          : pollIntervalSeconds != null && <> · 每 {pollIntervalSeconds} 秒自动刷新</>}
      </footer>
    </div>
  );
}

// Small inline component for the empty states. Kept private — not exported,
// only this view uses it. Same shape as the one in RoundRankingView /
// DisplayFinalRankingView so the style does not jump between modes.
function EmptyState({ title, subtitle }) {
  return (
    <div className="text-center text-gray-500 py-20">
      <div className="text-6xl mb-4">📊</div>
      <div className="text-2xl font-semibold text-gray-300">{title}</div>
      {subtitle && <div className="text-base mt-3">{subtitle}</div>}
    </div>
  );
}
