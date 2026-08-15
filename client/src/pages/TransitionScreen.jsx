/**
 * TransitionScreen — shown between two rounds of the same stage.
 *
 * Lifecycle position: between ROUND_FINISHED (of round N) and
 * ROUND_PREPARATION_STARTED (of round N+1). The server emits
 * ROUND_TRANSITION_STARTED with a duration, schedules the next round's
 * preparation after DEFAULT_TRANSITION_SECONDS, and the client until now
 * showed nothing.
 *
 * Three things matter here:
 *   1. The countdown reuses useTimer — the same hook the match timer and
 *      PreparationScreen use. The server sends a *duration* (transitionSeconds),
 *      not an absolute instant; useGameSocket fabricates turnEndsAt at event
 *      arrival time. No setInterval, no second countdown.
 *   2. The screen is deliberately silent about results, score, and ranking.
 *      Showing a rank to a player about to start another round loads them at
 *      the worst moment — rankings exist for the judge and the big screen.
 *      The screen says: what just finished, what comes next, how long until
 *      it starts. Nothing else.
 *   3. Priority in PlayerGamePage is explicit: transition > preparation >
 *      round views > waiting. A transition state that survives the next
 *      round's arrival is a bug — useGameSocket clears it on both
 *      ROUND_STARTED and ROUND_PREPARATION_STARTED.
 *
 * Data source: the `transition` object from useGameSocket, shape:
 *   { finishedRound: { roundName, roundType } | null,
 *     nextRound: { roundName, roundType, roundNumber },
 *     durationSeconds, turnEndsAt }
 *
 * `finishedRound` is null when the client doesn't know the previous round's
 * name — e.g., a page reload during the transition window. The screen falls
 * back to a generic message rather than showing the roundId (which is a
 * UUID and useless to a player).
 */
import { useLanguage } from '../i18n/LanguageContext';
import { useTimer } from '../hooks/useTimer';

// Maps a roundType to a human-readable label. Reuses existing common.roundName
// keys so we don't invent parallel vocabulary — same map as PreparationScreen.
const ROUND_TYPE_LABEL_KEY = {
  ROUND1_NINE_ONE: 'common.roundName.ROUND1_NINE_ONE',
  ROUND2_RELAY: 'common.roundName.ROUND2_RELAY',
  ROUND3_COLLABORATE: 'common.roundName.ROUND3_COLLABORATE',
};

function typeLabel(roundType, t) {
  if (!roundType) return '';
  return ROUND_TYPE_LABEL_KEY[roundType]
    ? t(ROUND_TYPE_LABEL_KEY[roundType])
    : roundType;
}

export default function TransitionScreen({ transition }) {
  const { t } = useLanguage();

  // useTimer reads turnEndsAt from a ref and runs a rAF loop — exactly what we
  // need for a smooth countdown. We pass timerStatus: 'RUNNING' so the loop
  // actually runs; the hook freezes on 'PAUSED' or 'FINISHED'.
  const { remainingSeconds, formattedTime } = useTimer({
    turnEndsAt: transition?.turnEndsAt ?? null,
    timerStatus: transition ? 'RUNNING' : 'UNKNOWN',
    durationSeconds: transition?.durationSeconds ?? 0,
  });

  if (!transition) return null;

  const finished = transition.finishedRound;
  const next = transition.nextRound || {};
  const finishedName = finished?.roundName;
  const nextName = next.roundName || `${t('transition.roundLabel')} ${next.roundNumber ?? ''}`.trim();
  const nextType = typeLabel(next.roundType, t);

  return (
    <div className="text-center py-10 sm:py-16 max-w-2xl mx-auto">
      <p className="text-gray-500 text-xs sm:text-sm uppercase tracking-wide mb-6">
        {t('transition.subtitle')}
      </p>

      {/* Finished round — name only, no score. If the client doesn't know
          the previous round's name (e.g., page reload during transition),
          fall back to a generic message. Never show the roundId. */}
      <div className="mb-8">
        {finishedName ? (
          <>
            <p className="text-gray-500 text-xs sm:text-sm mb-1">
              {t('transition.finishedLabel')}
            </p>
            <p className="text-gray-300 text-lg sm:text-xl font-medium break-words">
              {finishedName}
            </p>
          </>
        ) : (
          <p className="text-gray-400 text-sm sm:text-base">
            {t('transition.finishedGeneric')}
          </p>
        )}
      </div>

      {/* Next round — the thing the player is about to face. Name + type. */}
      <div className="mb-8">
        <p className="text-gray-500 text-xs sm:text-sm mb-1">
          {t('transition.nextLabel')}
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2 break-words">
          {nextName}
        </h1>
        {nextType && (
          <p className="text-blue-300 text-sm sm:text-base">{nextType}</p>
        )}
      </div>

      {/* Countdown — same useTimer + same display pattern as PreparationScreen. */}
      <div className="inline-flex flex-col items-center">
        <span className="text-gray-500 text-xs sm:text-sm mb-2">
          {t('transition.startingIn')}
        </span>
        <span
          className="text-5xl sm:text-6xl font-mono font-bold text-white tabular-nums"
          aria-live="polite"
        >
          {remainingSeconds}
        </span>
        <span className="text-gray-600 text-xs mt-1 tabular-nums">
          {formattedTime}
        </span>
      </div>
    </div>
  );
}
