/**
 * WaitingScreen — shown to a player when no round is active yet.
 *
 * Lifecycle position: the very first state of a competition (WAITING).
 * The player is logged in, but nothing has started. This screen replaces
 * the old two-line placeholder and shows the full programme: every stage
 * in order, its type, and how many rounds it holds.
 *
 * Data sources (both already exist, no backend work):
 *   - api.getCompetition(id)  → name, description
 *   - api.listStages(id)      → [{ id, type, order_number, rounds: [...] }, ...]
 *
 * Three distinct states are rendered, never conflated:
 *   - loading:  neither request has answered yet
 *   - error:    listStages failed — show the reason, NOT a silent empty list
 *   - empty:    listStages succeeded but returned [] — the competition truly
 *               has no stages yet, which is a different message than an error
 *   - success:  stages present — show the programme
 *
 * getCompetition failure degrades gracefully (name falls back to a default),
 * because the waiting message and the programme can still stand without it.
 * A listStages failure, by contrast, hides the programme entirely and says
 * why — per the task spec, "un échec doit dire pourquoi".
 */
import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

// Maps a stage `type` (INDIVIDUAL / TEAM / PK) to its existing i18n key.
// The keys live under competitionDetail.* and already cover all three types,
// so no new vocabulary is invented here.
const STAGE_TYPE_KEY = {
  INDIVIDUAL: 'competitionDetail.stageTypeIndividual',
  TEAM: 'competitionDetail.stageTypeTeam',
  PK: 'competitionDetail.stageTypePK',
};

export default function WaitingScreen({ competitionId }) {
  const { t } = useLanguage();
  const [competition, setCompetition] = useState(null);
  const [stages, setStages] = useState(null);
  // stagesError holds the reason when listStages fails, so a real failure is
  // distinguishable from a competition that simply has no stages yet.
  const [stagesError, setStagesError] = useState(null);

  useEffect(() => {
    if (!competitionId) return;

    // Name/description: a failure degrades gracefully. The waiting message
    // and the programme can still render without a name — and a missing name
    // is far less misleading than a missing programme.
    api.getCompetition(competitionId).then((res) => {
      if (res.code === 200 && res.data) setCompetition(res.data);
    });

    // Stages: a failure must be reported, not hidden. The whole point of the
    // distinct empty/error states is that a broken call and a stage-less
    // competition mean opposite things.
    api.listStages(competitionId).then((res) => {
      if (res.code === 200 && Array.isArray(res.data)) {
        setStages(res.data);
        setStagesError(null);
      } else {
        setStages(null);
        // res.message is the translated reason coming back from the API layer.
        setStagesError(res.message || t('waiting.programmeError'));
      }
    });
  }, [competitionId, t]);

  const name = competition?.name || t('game.defaultCompetitionName');
  const description = competition?.description;
  const stagesLoaded = Array.isArray(stages);
  const hasStages = stagesLoaded && stages.length > 0;

  return (
    <div className="text-center py-12 sm:py-20 max-w-2xl mx-auto">
      <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2 break-words">
        {name}
      </h1>
      {description && (
        <p className="text-gray-400 text-sm sm:text-base mb-4 break-words">
          {description}
        </p>
      )}
      <p className="text-gray-400 text-base sm:text-lg">
        {t('game.waitingRound')}
      </p>
      <p className="text-gray-500 text-xs sm:text-sm mt-2 mb-8">
        {t('game.waitingRoundHint')}
      </p>

      <div className="border-t border-gray-700 pt-6 text-left">
        <h2 className="text-gray-300 text-sm sm:text-base font-semibold mb-4 uppercase tracking-wide">
          {t('waiting.programmeTitle')}
        </h2>

        {stagesError ? (
          <p className="text-red-400 text-sm sm:text-base">
            {t('waiting.programmeError')}: {stagesError}
          </p>
        ) : !stagesLoaded ? (
          <p className="text-gray-500 text-sm sm:text-base">
            {t('waiting.programmeLoading')}
          </p>
        ) : !hasStages ? (
          <p className="text-gray-500 text-sm sm:text-base">
            {t('waiting.noStages')}
          </p>
        ) : (
          <ol className="space-y-3">
            {stages.map((stage, index) => {
              const typeLabel = STAGE_TYPE_KEY[stage.type]
                ? t(STAGE_TYPE_KEY[stage.type])
                : stage.type;
              const roundCount = Array.isArray(stage.rounds)
                ? stage.rounds.length
                : 0;
              return (
                <li
                  key={stage.id || index}
                  className="flex items-center justify-between bg-gray-800/50 rounded-lg px-4 py-3"
                >
                  <span className="flex items-center gap-3 text-white text-sm sm:text-base">
                    <span className="text-gray-500 w-6 text-center">
                      {index + 1}
                    </span>
                    <span>{typeLabel}</span>
                  </span>
                  <span className="text-gray-400 text-xs sm:text-sm">
                    {t('competitionDetail.stageRoundCount', { count: roundCount })}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
