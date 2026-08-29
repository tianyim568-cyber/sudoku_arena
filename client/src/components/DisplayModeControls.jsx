/**
 * DisplayModeControls — admin block to choose what the big screen shows.
 *
 * The server knows six display modes (see engine/DisplayModes.js). Five have
 * a client view today: DEFAULT (the normal ranking grid), LIVE_RANKING (the
 * live leaderboard), ROUND_RANKING (the ranking of one round, large — see
 * RoundRankingView), STAGE_RANKING (the ranking of one stage, large — see
 * DisplayStageRankingView), and FINAL_RANKING (the final podium, large — see
 * DisplayFinalRankingView). PLAYER_BROADCAST is driven by the "project"
 * button in JudgeMonitoringPanel — we do not duplicate it here. Five modes,
 * then.
 *
 * Where the current mode comes from: the parent passes `currentMode`, read
 * from `competition.display_mode` (the GET /competitions/:id route returns
 * the column). We do NOT trust what the judge last clicked — another admin
 * may have changed the mode from another tab. The WS event
 * DISPLAY_MODE_CHANGED is the server's push that the mode moved; we listen
 * for it and ask the parent to refresh, so the highlighted button tracks
 * the server, not the click.
 *
 * Coherence with PLAYER_BROADCAST: if a player is being projected (mode is
 * PLAYER_BROADCAST) and the judge clicks DEFAULT, LIVE_RANKING, or
 * ROUND_RANKING here, we call stopBroadcast FIRST, then setDisplayMode. The
 * reason is on the server: setDisplayMode updates `display_mode` but does
 * NOT clear `broadcast_player_id` — so switching away without stopBroadcast
 * would leave a dangling id on the competition row. Calling stopBroadcast
 * cleans the projection state, then setDisplayMode sets the new mode. The
 * screen side already handles DISPLAY_MODE_CHANGED by dropping the broadcast
 * player locally, so the room sees the switch immediately.
 *
 * Visibility: every authenticated role on the judge-control page (JUDGE,
 * ORG_ADMIN, SUPER_ADMIN) can switch the display mode. This is a floor
 * operation — the judge running the room decides what the screen shows,
 * not just the organization admin. The server's PUT /display/mode route
 * accepts JUDGE, ORG_ADMIN and SUPER_ADMIN, so the client always renders
 * the buttons (the tenantGuard still ensures the caller belongs to the
 * competition's organization). Token generation/revoke stays admin-only —
 * see DisplayTokenSection.
 *
 * Error handling: if the switch fails (403, network, anything), we show the
 * message and do NOT update the highlighted button. The judge must see that
 * the room did not move — a button that pretends it worked is the bug we
 * are here to prevent.
 */
import { useState, useCallback, useEffect } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';
import { connectSocket, onEvent } from '../api/socket';

// The modes we expose as buttons. The server defines six; five have a
// client view today (DEFAULT, LIVE_RANKING, ROUND_RANKING, STAGE_RANKING,
// FINAL_RANKING). PLAYER_BROADCAST is set by the projection button in
// JudgeMonitoringPanel — we recognize the state but do not offer a button.
const MODE_DEFAULT = 'DEFAULT';
const MODE_LIVE_RANKING = 'LIVE_RANKING';
const MODE_ROUND_RANKING = 'ROUND_RANKING';
const MODE_STAGE_RANKING = 'STAGE_RANKING';
const MODE_FINAL_RANKING = 'FINAL_RANKING';
// The server sets this when a player is projected via JudgeMonitoringPanel.
// We do not offer a button for it, but we must recognize the state so we can
// call stopBroadcast before switching away.
const MODE_PLAYER_BROADCAST = 'PLAYER_BROADCAST';

export default function DisplayModeControls({ competitionId, currentMode, onModeChanged }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Listen for DISPLAY_MODE_CHANGED so the highlighted button tracks the
  // server, not just what this judge last clicked. Another admin (or this
  // judge from another tab) may have switched the mode — when the server
  // pushes the event, we ask the parent to refresh the competition object.
  useEffect(() => {
    connectSocket();
    const cleanup = onEvent((event) => {
      if (event.type !== 'DISPLAY_MODE_CHANGED') return;
      if (event.competitionId !== competitionId) return;
      // Ask the parent to re-read the competition row; currentMode will
      // update on the next render. We do not set local state from the
      // payload — the server is the source of truth, and a fresh GET is
      // cheap and unambiguous.
      if (typeof onModeChanged === 'function') onModeChanged();
    });
    return cleanup;
  }, [competitionId, onModeChanged]);

  const handleSwitch = useCallback(async (targetMode) => {
    if (busy) return;
    setBusy(true);
    setError(null);

    // If a player is being projected, clean the projection state FIRST.
    // setDisplayMode alone would leave broadcast_player_id dangling on the
    // competition row — see the component doc.
    if (currentMode === MODE_PLAYER_BROADCAST) {
      const stopRes = await api.stopBroadcast(competitionId);
      if (stopRes.code !== 200) {
        setBusy(false);
        setError(stopRes.message || t('displayMode.switchFailed'));
        return;
      }
    }

    const res = await api.setDisplayMode(competitionId, targetMode);
    setBusy(false);

    if (res.code === 200) {
      // Ask the parent to refresh — the new mode shows up via
      // competition.display_mode, not via local optimism.
      if (typeof onModeChanged === 'function') onModeChanged();
    } else {
      // 403, 500, network — do not update the highlight. The judge must
      // see that the room did not move.
      setError(res.message || t('displayMode.switchFailed'));
    }
  }, [busy, competitionId, currentMode, onModeChanged, t]);

  // The modes we expose as buttons. Order matters for the layout, not for
  // the behavior — each is an independent toggle. The order reflects the
  // granularity ladder (round → stage → final), so the judge sees the
  // scope grow left-to-right.
  const modes = [
    { value: MODE_DEFAULT, label: t('displayMode.modeDefault'), hint: t('displayMode.modeDefaultHint') },
    { value: MODE_LIVE_RANKING, label: t('displayMode.modeLiveRanking'), hint: t('displayMode.modeLiveRankingHint') },
    { value: MODE_ROUND_RANKING, label: t('displayMode.modeRoundRanking'), hint: t('displayMode.modeRoundRankingHint') },
    { value: MODE_STAGE_RANKING, label: t('displayMode.modeStageRanking'), hint: t('displayMode.modeStageRankingHint') },
    { value: MODE_FINAL_RANKING, label: t('displayMode.modeFinalRanking'), hint: t('displayMode.modeFinalRankingHint') },
  ];

  return (
    <section className="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 className="text-base sm:text-lg font-semibold mb-1">
        {t('displayMode.title')}
      </h2>
      <p className="text-gray-500 text-xs sm:text-sm mb-3 sm:mb-4">
        {t('displayMode.subtitle')}
      </p>

      {/* Current mode — visible so the judge knows what the room sees
          without looking at the screen. Shown to everyone, including a
          plain judge: they may not be able to switch the mode, but they
          still need to know what the room is watching. */}
      <div className="mb-3 sm:mb-4 px-3 py-2 bg-gray-50 border rounded text-xs sm:text-sm text-gray-700">
        <span className="font-medium">{t('displayMode.currentLabel')}</span>{' '}
        <span className="font-semibold text-gray-900">
          {currentMode === MODE_LIVE_RANKING
            ? t('displayMode.modeLiveRanking')
            : currentMode === MODE_ROUND_RANKING
              ? t('displayMode.modeRoundRanking')
              : currentMode === MODE_STAGE_RANKING
                ? t('displayMode.modeStageRanking')
                : currentMode === MODE_FINAL_RANKING
                  ? t('displayMode.modeFinalRanking')
                  : currentMode === MODE_PLAYER_BROADCAST
                    ? t('displayMode.modePlayerBroadcast')
                    : t('displayMode.modeDefault')}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 sm:gap-3">
        {modes.map((m) => {
          const isActive = currentMode === m.value;
          return (
            <button
              key={m.value}
              onClick={() => handleSwitch(m.value)}
              disabled={busy}
              title={m.hint}
              className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors border disabled:opacity-50 ${
                isActive
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {/* When a player is being projected, surface what will happen if
          the judge clicks a mode here — the projection stops. This is
          the coherence decision made explicit for the judge. */}
      {currentMode === MODE_PLAYER_BROADCAST && (
        <p className="mt-3 text-xs sm:text-sm text-amber-700">
          {t('displayMode.projectedHint')}
        </p>
      )}

      {error && <p className="mt-3 text-red-600 text-xs sm:text-sm">{error}</p>}
    </section>
  );
}
