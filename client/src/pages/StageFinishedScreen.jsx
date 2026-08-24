/**
 * StageFinishedScreen — shown to a player when a stage ends, or when the
 * whole competition ends.
 *
 * Lifecycle position:
 *   - variant="stage"        — between STAGE_FINISHED (the last round of
 *                               stage N just ended) and the first
 *                               ROUND_PREPARATION_STARTED of stage N+1.
 *                               The server does NOT auto-start the next
 *                               stage: the judge clicks "start next stage"
 *                               manually. There is no countdown to show
 *                               the player — the wait length is unknown.
 *   - variant="competition"  — after COMPETITION_FINISHED. Terminal screen.
 *
 * What this screen deliberately does NOT show:
 *   - No score, no ranking, no podium. Product decision (2026-08-15):
 *     mid-competition rankings are for the judge and the big screen, not
 *     for a player about to play another round. The end-of-competition
 *     variant says "thanks for taking part" — that is all.
 *
 * Visual model: TransitionScreen, minus the timer. The shared structure
 * is a centered column with a small uppercase subtitle, a big title, and
 * a neutral-waiting message below. No `useTimer` here: the judge decides
 * when the next stage starts, and fabricating a countdown would lie to
 * the player.
 *
 * Props:
 *   variant:       'stage' | 'competition' — picks the wording.
 *   stageOrder:    number | null — "Stage N finished". Null falls back to
 *                  the no-number variant.
 *   stageType:     'INDIVIDUAL' | 'TEAM' | null — subtitle label when the
 *                  variant is 'stage'. Null or an unknown type is silently
 *                  omitted (no crash, no bogus line).
 */
import { useLanguage } from '../i18n/LanguageContext';

// Maps a stage `type` to its existing i18n key. The keys already cover
// INDIVIDUAL and TEAM (competitionDetail.*), so we don't invent parallel
// vocabulary. PK is intentionally absent — the engine exposes PK as a
// stage type but it is currently disabled, and showing a "PK stage" label
// to a player who just finished an individual stage would be misleading.
// An unknown type renders nothing (defensive).
const STAGE_TYPE_LABEL_KEY = {
  INDIVIDUAL: 'stageFinished.stageSubtitleIndividual',
  TEAM: 'stageFinished.stageSubtitleTeam',
};

export default function StageFinishedScreen({ variant, stageOrder = null, stageType = null }) {
  const { t } = useLanguage();

  // Unknown variant — render nothing instead of crashing. chooseScreen
  // only ever returns 'STAGE_FINISHED' or 'COMPETITION_FINISHED', so this
  // is purely defensive against a future caller passing the wrong string.
  if (variant !== 'stage' && variant !== 'competition') return null;

  if (variant === 'competition') {
    // No small uppercase subtitle here: the original code repeated
    // competitionTitle twice (once small, once big) and printed the
    // sentence twice on screen. The end-of-competition screen is
    // deliberately one big statement + thanks, nothing else.
    return (
      <div className="text-center py-12 sm:py-20 max-w-2xl mx-auto">
        <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4 break-words">
          {t('stageFinished.competitionTitle')}
        </h1>
        <p className="text-gray-400 text-base sm:text-lg">
          {t('stageFinished.competitionThanks')}
        </p>
      </div>
    );
  }

  // variant === 'stage'
  const title = (stageOrder == null)
    ? t('stageFinished.stageTitleNoNumber')
    : t('stageFinished.stageTitle', { n: stageOrder });
  const subtitle = stageType && STAGE_TYPE_LABEL_KEY[stageType]
    ? t(STAGE_TYPE_LABEL_KEY[stageType])
    : '';

  return (
    <div className="text-center py-12 sm:py-20 max-w-2xl mx-auto">
      {/* Small uppercase kicker. Uses a dedicated key rather than
          transition.subtitle ("Transition") — a stage END is not a
          round-to-round transition; reusing that string would mislead. */}
      <p className="text-gray-500 text-xs sm:text-sm uppercase tracking-wide mb-6">
        {t('stageFinished.stageKicker')}
      </p>
      <h1 className="text-2xl sm:text-3xl font-bold text-white mb-4 break-words">
        {title}
      </h1>
      {subtitle && (
        <p className="text-blue-300 text-sm sm:text-base mb-8">
          {subtitle}
        </p>
      )}
      <p className="text-gray-400 text-base sm:text-lg">
        {t('stageFinished.stageWait')}
      </p>
    </div>
  );
}
