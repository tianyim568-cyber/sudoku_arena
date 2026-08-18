/**
 * PreparationScreen — shown between "judge starts round" and "round goes live".
 *
 * Lifecycle position: PREPARATION. The server emits ROUND_PREPARATION_STARTED,
 * then TIMER_TICKs tagged with phase: 'preparation' every ~10 s, then
 * ROUND_STARTED when gameplay begins. PreparationScreen occupies that gap.
 *
 * Three things matter here:
 *   1. The countdown is computed locally via useTimer (same hook as the match
 *      timer) and recalibrated by server ticks — never a second countdown hook.
 *   2. The match-header timer stays mute during preparation. useGameSocket
 *      routes preparation ticks to a `preparation` state, NOT to `timerMeta`,
 *      so TimerDisplay in the header never sees them.
 *   3. The rules shown depend on the round type. Three types exist; an unknown
 *      type degrades to a generic message rather than crashing the screen.
 *
 * Data source: the `preparation` object from useGameSocket, shape:
 *   { roundId, roundNumber, roundName, roundType, preparationSeconds,
 *     durationSeconds, turnEndsAt }
 */
import { useLanguage } from '../i18n/LanguageContext';
import { useTimer } from '../hooks/useTimer';

// Maps a roundType to the i18n key holding its player-facing rules. The three
// types match Round1View / Round2View / Round3View. An unknown type falls back
// to `preparation.rulesUnknown` so the screen never breaks on a new type the
// client hasn't learned about yet.
const RULES_KEY = {
  ROUND1_NINE_ONE: 'preparation.rulesRound1',
  ROUND2_RELAY: 'preparation.rulesRound2',
  ROUND3_COLLABORATE: 'preparation.rulesRound3',
};

// Maps a roundType to a human-readable label. Reuses existing common.roundName
// keys so we don't invent parallel vocabulary.
const ROUND_TYPE_LABEL_KEY = {
  ROUND1_NINE_ONE: 'common.roundName.ROUND1_NINE_ONE',
  ROUND2_RELAY: 'common.roundName.ROUND2_RELAY',
  ROUND3_COLLABORATE: 'common.roundName.ROUND3_COLLABORATE',
};

export default function PreparationScreen({ preparation }) {
  const { t } = useLanguage();

  // useTimer reads turnEndsAt from a ref and runs a rAF loop — exactly what we
  // need for a smooth countdown that recalibrates on every server tick. We
  // pass timerStatus: 'RUNNING' so the loop actually runs; the hook freezes on
  // 'PAUSED' or 'FINISHED'.
  const { remainingSeconds, formattedTime } = useTimer({
    turnEndsAt: preparation?.turnEndsAt ?? null,
    timerStatus: preparation ? 'RUNNING' : 'UNKNOWN',
    durationSeconds: preparation?.durationSeconds ?? 0,
  });

  if (!preparation) return null;

  const roundType = preparation.roundType;
  const typeLabel = ROUND_TYPE_LABEL_KEY[roundType]
    ? t(ROUND_TYPE_LABEL_KEY[roundType])
    : roundType || t('preparation.unknownRoundType');
  const rulesKey = RULES_KEY[roundType] || 'preparation.rulesUnknown';
  const roundName = preparation.roundName || `${t('preparation.roundLabel')} ${preparation.roundNumber ?? ''}`.trim();

  return (
    <div className="text-center py-10 sm:py-16 max-w-2xl mx-auto">
      <p className="text-gray-500 text-xs sm:text-sm uppercase tracking-wide mb-3">
        {t('preparation.subtitle')}
      </p>
      <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2 break-words">
        {roundName}
      </h1>
      <p className="text-blue-300 text-sm sm:text-base mb-8">
        {typeLabel}
      </p>

      <div className="bg-gray-800/50 rounded-lg px-4 py-4 sm:px-6 sm:py-5 mb-8 text-left">
        <h2 className="text-gray-300 text-xs sm:text-sm font-semibold mb-2 uppercase tracking-wide">
          {t('preparation.rulesTitle')}
        </h2>
        <p className="text-gray-200 text-sm sm:text-base leading-relaxed">
          {t(rulesKey)}
        </p>
      </div>

      <div className="inline-flex flex-col items-center">
        <span className="text-gray-500 text-xs sm:text-sm mb-2">
          {t('preparation.startingIn')}
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
