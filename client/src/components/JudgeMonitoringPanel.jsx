/**
 * JudgeMonitoringPanel — the judge's live view of participants.
 *
 * Three things this panel does:
 *   1. Overview: every participant with online/offline presence.
 *   2. Detail: click a participant, see their current grid + progress.
 *   3. Project: one-click "put this player on the big screen" (admin only).
 *
 * ── Refresh strategy ────────────────────────────────────────────────
 *
 * Two mechanisms were available, and only one carries each concern:
 *
 *   - Presence: real-time. The server pushes PARTICIPANT_LIST_STATE_UPDATE
 *     to the judge's user room whenever a player connects, disconnects,
 *     or goes stale. We subscribe via `onEvent` and replace the list.
 *     No polling for presence — that would compete with the push and
 *     give stale reads.
 *
 *   - Initial fetch: one GET /monitoring/participants on mount. The WS
 *     event only fires on CHANGE; without the initial fetch the panel
 *     would stay empty until the next player connects.
 *
 * The 5-second `loadRoomStatus` polling on the parent JudgeControlPage
 * is a different concern (room/teams status) and does not overlap.
 *
 * ── Projection (big screen) ─────────────────────────────────────────
 *
 * Product decision 2026-08-24: projection is a floor operation and is
 * reserved for the JUDGE (SUPER_ADMIN too, for platform debugging).
 * ORG_ADMIN is intentionally excluded — the org admin does configuration,
 * the judge runs the room. The server gates PUT/DELETE /display/broadcast*
 * accordingly (403 for anybody else). We surface the buttons only when
 * `canProject` is true, and explain the restriction to whoever is not
 * eligible via the projection notice.
 *
 * ── Large lists ────────────────────────────────────────────────────
 *
 * A competition can have 200+ participants. We cap rendering at
 * VIRTUAL_MAX rows and slice the sorted list — online first, then
 * offline. The full list stays in state; a search box filters by
 * name/school/team. No virtualization library: the cap keeps the DOM
 * small, and the search lets the judge find one player among many.
 *
 * ── Status values ──────────────────────────────────────────────────
 *
 * The migration to stages renamed several status values, and a stale
 * comparison silently renders nothing (no error, no warning). The
 * server writes these for sessions: WAITING / RUNNING / IN_PROGRESS /
 * PAUSED / FINISHED. We display whatever comes, via the i18n status
 * dictionary — we do NOT branch on a value, because branching on a
 * stale value is the bug that cost weeks here.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';
import { connectSocket, onEvent } from '../api/socket';
import JudgeLivePlayerView from './JudgeLivePlayerView';

// Render cap for the participant list. Beyond this, the list is sliced
// to keep the DOM tractable for 200+ participants. The judge can still
// search to find someone beyond the cap.
const VIRTUAL_MAX = 100;

export default function JudgeMonitoringPanel({ competitionId }) {
  const { user } = useAuth();
  const { t } = useLanguage();

  // Projection eligibility — see the "Projection (big screen)" section
  // in this file's docstring. JUDGE is the primary case; SUPER_ADMIN keeps
  // access for platform-level debugging (rare) — kept in sync with the
  // roleMiddleware on routes/display.js. ORG_ADMIN is intentionally NOT
  // here.
  const canProject = user?.role === 'JUDGE' || user?.role === 'SUPER_ADMIN';

  // Overview state
  const [participants, setParticipants] = useState(null); // null = loading
  const [listError, setListError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');

  // Detail state — fetched on click, refetched on round transitions.
  const [detail, setDetail] = useState(null); // { data, loading, error }
  const [detailVersion, setDetailVersion] = useState(0); // bump to refetch

  // Projection state — local-only. The server is the source of truth
  // for who is broadcast (competition.broadcast_player_id), but we do
  // not fetch that on every render. Instead we track the action in
  // flight and show the result. The big-screen display page polls the
  // ranking snapshot which carries displayMode + broadcastPlayer; the
  // judge does not need to see that, only to know their click worked.
  const [projectingId, setProjectingId] = useState(null);
  const [projectError, setProjectError] = useState(null);

  // ── Initial fetch + WS subscription ──────────────────────────────
  const fetchParticipants = useCallback(async () => {
    setListError(null);
    const res = await api.getMonitoringParticipants(competitionId);
    if (res.code === 200) {
      setParticipants(res.data);
    } else {
      setParticipants(null);
      setListError(res.message || t('judgeMonitoring.loadFailed'));
    }
  }, [competitionId, t]);

  useEffect(() => {
    fetchParticipants();
  }, [fetchParticipants]);

  // Subscribe to PARTICIPANT_LIST_STATE_UPDATE — the server pushes this
  // to the judge's user room whenever a player's presence changes.
  // connectSocket() is idempotent: if the parent already connected, we
  // reuse that socket. We do NOT call disconnectSocket() on cleanup —
  // the parent owns the lifecycle.
  useEffect(() => {
    if (!user) return;
    // Ensure the socket is up so the server can route to user_<id>. That room
    // is joined automatically on connect (SocketManager does socket.join on
    // the user id), so PARTICIPANT_LIST_STATE_UPDATE reaches us without a
    // joinRoom call — the event is user-targeted, not competition-scoped.
    connectSocket();

    const cleanup = onEvent((event) => {
      if (event.type !== 'PARTICIPANT_LIST_STATE_UPDATE') return;
      // The event is targeted (user_<userId> room), but the payload
      // carries competitionId — only apply if it matches ours. This
      // guards against a judge who is assigned to two competitions.
      if (event.competitionId !== competitionId) return;
      if (!event.payload) return;
      setParticipants({
        competitionId,
        participants: event.payload.participants || [],
        summary: event.payload.summary || { total: 0, online: 0, offline: 0 },
      });
    });

    return cleanup;
  }, [user, competitionId]);

  // ── Detail fetch ─────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setDetail({ data: null, loading: true, error: null });
      const res = await api.getMonitoringPlayer(competitionId, selectedId);
      if (cancelled) return;
      if (res.code === 200) {
        setDetail({ data: res.data, loading: false, error: null });
      } else {
        setDetail({ data: null, loading: false, error: res.message || t('judgeMonitoring.detailLoadFailed') });
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, competitionId, detailVersion, t]);

  // ── Projection ───────────────────────────────────────────────────
  const handleProject = useCallback(async (playerId, playerName) => {
    if (!canProject) return;
    if (!window.confirm(t('judgeMonitoring.projectConfirm'))) return;
    setProjectingId(playerId);
    setProjectError(null);
    const res = await api.broadcastPlayer(competitionId, playerId);
    setProjectingId(null);
    if (res.code === 200) {
      // Optimistically mark this player as the one on the big screen.
      // The server is the source of truth; we do not refetch here.
      setSelectedId(playerId);
    } else {
      setProjectError(t('judgeMonitoring.projectFailed', { msg: res.message || '' }));
    }
  }, [canProject, competitionId, t]);

  const handleStopProject = useCallback(async () => {
    if (!canProject) return;
    if (!window.confirm(t('judgeMonitoring.stopProjectConfirm'))) return;
    setProjectingId('stop');
    setProjectError(null);
    const res = await api.stopBroadcast(competitionId);
    setProjectingId(null);
    if (res.code !== 200) {
      setProjectError(t('judgeMonitoring.stopProjectFailed', { msg: res.message || '' }));
    }
  }, [canProject, competitionId, t]);

  // ── Derived view ─────────────────────────────────────────────────
  const sorted = useMemo(() => {
    if (!participants?.participants) return [];
    // Online first, then by name. The judge's job is to spot problems —
    // online players are where the action is, so they go on top.
    const list = [...participants.participants];
    list.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      const an = a.name || '';
      const bn = b.name || '';
      return an.localeCompare(bn);
    });
    return list;
  }, [participants]);

  const filtered = useMemo(() => {
    if (!search.trim()) return sorted;
    const q = search.trim().toLowerCase();
    return sorted.filter(p =>
      (p.name || '').toLowerCase().includes(q) ||
      (p.school || '').toLowerCase().includes(q) ||
      (p.teamName || '').toLowerCase().includes(q)
    );
  }, [sorted, search]);

  const visible = filtered.slice(0, VIRTUAL_MAX);
  const overflow = filtered.length - visible.length;

  const summary = participants?.summary || { total: 0, online: 0, offline: 0 };

  return (
    <section className="bg-white rounded-xl shadow p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-base sm:text-lg font-semibold">{t('judgeMonitoring.title')}</h2>
          {participants && (
            <p className="text-xs sm:text-sm text-gray-500">
              {t('judgeMonitoring.subtitle', { online: summary.online, total: summary.total })}
            </p>
          )}
        </div>
        <button
          onClick={fetchParticipants}
          className="self-start sm:self-auto px-3 py-1.5 border border-gray-300 rounded text-xs sm:text-sm hover:bg-gray-50"
        >
          {t('judgeMonitoring.refresh')}
        </button>
      </div>

      {/* Search — only useful when the list is long. We show it whenever
          there is at least one participant, so the judge can always
          filter by name/school/team. */}
      {participants && participants.participants.length > 0 && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('judgeMonitoring.searchPlaceholder')}
          className="w-full mb-3 px-3 py-1.5 border border-gray-300 rounded text-xs sm:text-sm"
        />
      )}

      {/* List states. Empty list is NOT an error — it's the normal
          pre-import state. Distinguish "nobody imported" from "nobody
          online" so the judge knows which it is. */}
      {listError && (
        <p className="text-red-600 text-xs sm:text-sm">{listError}</p>
      )}

      {!participants && !listError && (
        <p className="text-gray-500 text-xs sm:text-sm">{t('judgeMonitoring.loading')}</p>
      )}

      {participants && participants.participants.length === 0 && (
        <p className="text-gray-500 text-xs sm:text-sm">{t('judgeMonitoring.empty')}</p>
      )}

      {participants && participants.participants.length > 0 && summary.online === 0 && (
        <p className="text-gray-500 text-xs sm:text-sm mb-2">{t('judgeMonitoring.emptyOnline')}</p>
      )}

      {/* The list itself. Click selects; online players show a green
          dot, offline a gray one.

          The row is a plain <div>, not a <button>, because it CONTAINS
          a <button> for projection and nesting interactive elements is
          invalid HTML. We keep it keyboard-operable via tabIndex +
          onKeyDown. No role="button" is set so the accessibility tree
          only exposes the real projection button as a button. */}
      {visible.length > 0 && (
        <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
          {visible.map((p) => (
            <li key={p.id}>
              <div
                onClick={() => setSelectedId(p.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(p.id); } }}
                tabIndex={0}
                className={`w-full text-left px-2 py-2 flex items-center gap-3 hover:bg-gray-50 rounded cursor-pointer ${
                  selectedId === p.id ? 'bg-indigo-50' : ''
                }`}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    p.online ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                  aria-label={p.online ? t('judgeMonitoring.statusOnline') : t('judgeMonitoring.statusOffline')}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{p.name}</span>
                    {p.teamName && (
                      <span className="text-xs text-gray-500 truncate">· {p.teamName}</span>
                    )}
                  </div>
                  {p.school && (
                    <div className="text-xs text-gray-500 truncate">{p.school}</div>
                  )}
                  {!p.online && p.lastHeartbeatAt && (
                    <div className="text-xs text-gray-400">{formatAgo(p.lastHeartbeatAt, t)}</div>
                  )}
                </div>
                {p.online && canProject && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleProject(p.id, p.name); }}
                    disabled={projectingId !== null}
                    className="px-2 py-1 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-500 disabled:opacity-50 flex-shrink-0"
                  >
                    {projectingId === p.id ? t('common.loading') : t('judgeMonitoring.projectButton')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Overflow notice — the list was capped, the judge can search to
          narrow it down. No virtualization library, just a cap + filter. */}
      {overflow > 0 && (
        <p className="text-xs text-gray-400 mt-2">
          {t('judgeMonitoring.overflow', { n: overflow })}
        </p>
      )}

      {/* Projection error — surfaces a 403 or network failure. */}
      {projectError && (
        <p className="text-red-600 text-xs sm:text-sm mt-2">{projectError}</p>
      )}

      {/* Judge-only projection notice. */}
      {!canProject && participants && participants.participants.length > 0 && (
        <p className="text-xs text-gray-400 mt-2">{t('judgeMonitoring.projectNotAllowed')}</p>
      )}

      {/* Detail panel. */}
      {selectedId && (
        <JudgeLivePlayerView
          competitionId={competitionId}
          playerId={selectedId}
          detail={detail}
          canProject={canProject}
          projectingId={projectingId}
          onProject={handleProject}
          onStopProject={handleStopProject}
          onClose={() => { setSelectedId(null); setDetail(null); }}
          onRefresh={() => setDetailVersion(v => v + 1)}
        />
      )}
    </section>
  );
}

/**
 * Format a heartbeat timestamp as "Ns/Nm/Nh ago". The server stores
 * lastHeartbeatAt as a unix-ms number. Returns a human string via the
 * i18n dictionary; if the input is missing or invalid, returns the
 * "never seen" label.
 */
function formatAgo(lastHeartbeatAt, t) {
  if (!lastHeartbeatAt || typeof lastHeartbeatAt !== 'number') {
    return t('judgeMonitoring.lastSeenNever');
  }
  const diffMs = Date.now() - lastHeartbeatAt;
  if (diffMs < 0) return t('judgeMonitoring.lastSeenNever');
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return t('judgeMonitoring.agoSeconds', { n: sec });
  const min = Math.floor(sec / 60);
  if (min < 60) return t('judgeMonitoring.agoMinutes', { n: min });
  const hr = Math.floor(min / 60);
  return t('judgeMonitoring.agoHours', { n: hr });
}
