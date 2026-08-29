/**
 * PublishPanel — the single, up-to-date readiness panel on the competition
 * detail page.
 *
 * This component replaces the v1 "ready to start" panel that hardcoded three
 * rounds and a team. The real rule, fixed by Louise and re-verified server-
 * side on every publish call, is:
 *
 *   publishable iff
 *     1. at least one judge
 *     2. at least one participant
 *     3. at least one stage
 *     4. every existing stage has at least one round AND every round has at
 *        least one puzzle
 *
 * The panel only displays. The route POST /:id/publish re-runs the check from
 * the real database state — a stale client snapshot cannot lie the competition
 * into PUBLISHED.
 *
 * The case that matters most (Louise's own words): "on ajoute une étape après
 * la publication". After publishing, the admin adds an unconfigured stage. The
 * status column still says PUBLISHED (we do not auto-downgrade), but the panel
 * must reflect that the competition is no longer publishable — the Start
 * button is disabled until the new stage is configured.
 *
 * Visibility: rendered for ORG_ADMIN / SUPER_ADMIN only. A judge or player on
 * this page never sees it, so they never hit a 403 on the publishability GET.
 */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

export default function PublishPanel({ competitionId, status, canStart, refreshKey, onStatusChange }) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  // The snapshot returned by GET /publishability: { status, publishable,
  // missing: [...] }. Loading state matters: flashing "not publishable"
  // before the answer arrives would make the admin think their ready
  // competition is broken.
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); // disables Publish / Start buttons during a request
  const [error, setError] = useState(null);
  // message = { text, type } — a transient toast after Publish/Cancel/Start.
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.getPublishability(competitionId);
    setLoading(false);
    if (res.code === 200) {
      setSnapshot(res.data);
    } else {
      setError(res.message || t('publishPanel.loadFailed'));
    }
  }, [competitionId, t]);

  useEffect(() => {
    // Loads on mount AND when the status prop changes — the parent reloads
    // the competition after a publish/cancel, and the panel must refresh
    // its snapshot to match the new status without a manual page reload.
    //
    // BUG-02 fix: also refetch when refreshKey changes. The parent
    // increments refreshKey after every successful mutation of sibling
    // panels (stages, rounds, participants, judges). Without this, adding
    // a stage after publication would leave the checklist stale until a
    // manual page reload — the admin thinks the "Has stages" check is
    // still green when it should be red.
    load();
  }, [status, load, refreshKey]);

  const showMsg = (text, type = 'info') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 5000);
  };

  // Build a translated publish-refusal message from the missing criterion
  // codes the server sends in res.data.missing (e.g. ['NO_JUDGE', 'ROUND_EMPTY']).
  // Each code maps to an existing i18n key under publishPanel.missing*.
  // The server's res.message is a Chinese-only concatenated string that
  // cannot be matched by translateServerMessage — building it here solves
  // the translation gap documented in ISSUE-037.
  const MISSING_CODE_TO_KEY = {
    NO_JUDGE: 'missingJudge',
    NO_PARTICIPANT: 'missingParticipant',
    NO_STAGE: 'missingStage',
    STAGE_EMPTY: 'missingStageRounds',
    ROUND_EMPTY: 'missingRoundPuzzles',
  };
  const buildPublishMessage = (missing) => {
    const items = missing.map(code => t(`publishPanel.${MISSING_CODE_TO_KEY[code] || code}`));
    return `${t('publishPanel.publishCannot')} ${items.join('; ')}`;
  };

  const handlePublish = async () => {
    setBusy(true);
    const res = await api.publishCompetition(competitionId);
    setBusy(false);
    if (res.code === 200) {
      // The parent learns about the status change by reloading; we refresh
      // the snapshot so the Start button lights up immediately.
      await load();
      if (onStatusChange) onStatusChange();
      showMsg(t('publishPanel.published'), 'success');
    } else {
      // The server refused. If we got the structured missing list (code 40010),
      // build a fully translated message client-side. Otherwise fall back to
      // the generic "publish failed" key.
      if (res.code === 40010 && res.data?.missing?.length) {
        showMsg(buildPublishMessage(res.data.missing), 'error');
        setSnapshot((prev) => prev ? { ...prev, missing: res.data.missing, publishable: false } : prev);
      } else {
        showMsg(t('publishPanel.publishFailed'), 'error');
      }
    }
  };

  const handleCancel = async () => {
    // Cancel is a DESTRUCTIVE action, not a toggle. It destroys the access
    // link (competition_access_code is cleared in the same update that
    // reverts the status), so anyone who received the URL — players,
    // judges, a big screen — can no longer enter. The competition reverts
    // to DRAFT and becomes editable again. The confirm must say this
    // explicitly: this is not "unpublish", it has consequences outside the
    // system.
    if (!window.confirm(t('publishPanel.cancelConfirm'))) return;
    setBusy(true);
    const res = await api.cancelCompetition(competitionId);
    setBusy(false);
    if (res.code === 200) {
      await load();
      if (onStatusChange) onStatusChange();
      showMsg(t('publishPanel.cancelled'), 'success');
    } else {
      showMsg(res.message || t('publishPanel.cancelFailed'), 'error');
    }
  };

  const handleStart = async () => {
    setBusy(true);
    const res = await api.startCompetition(competitionId);
    setBusy(false);
    if (res.code === 200) {
      showMsg(t('publishPanel.started'), 'success');
      navigate(`/judge/${competitionId}`);
    } else {
      showMsg(res.message || t('publishPanel.startFailed'), 'error');
    }
  };

  const publishable = snapshot?.publishable === true;
  const missing = snapshot?.missing || [];
  const isPublished = status === 'PUBLISHED';
  const isRunning = status === 'RUNNING';
  const isFinished = status === 'FINISHED';
  const isDraft = status === 'DRAFT';

  // Once the competition is RUNNING or FINISHED, publication is moot. The
  // panel collapses to a single line so the admin does not see a useless
  // "Publish" button on a finished competition.
  if (isRunning || isFinished) return null;

  const Check = ({ ok }) => (
    <span className={`inline-block w-5 h-5 rounded-full text-center text-white text-xs leading-5 ${ok ? 'bg-green-500' : 'bg-red-400'}`}>
      {ok ? '✓' : '✗'}
    </span>
  );

  return (
    <section className="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 className="text-base sm:text-lg font-semibold mb-3">
        {t('publishPanel.title')}
      </h2>

      {message && (
        <div className={`mb-3 px-4 py-3 rounded-lg text-xs sm:text-sm ${
          message.type === 'error'
            ? 'bg-red-50 text-red-700 border border-red-200'
            : 'bg-green-50 text-green-700 border border-green-200'
        }`}>
          {message.text}
        </div>
      )}

      {loading && (
        <p className="text-gray-400 text-xs sm:text-sm">{t('common.loading')}</p>
      )}

      {error && !loading && (
        <p className="text-red-600 text-xs sm:text-sm">{error}</p>
      )}

      {!loading && !error && snapshot && (
        <>
          {/* The checklist. Each criterion is independent — the admin sees
              the full punch list, not just the first blocker. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs sm:text-sm">
            <div className="flex items-center gap-2">
              <Check ok={!missing.includes('NO_JUDGE')} />
              {t('publishPanel.missingJudge')}
            </div>
            <div className="flex items-center gap-2">
              <Check ok={!missing.includes('NO_PARTICIPANT')} />
              {t('publishPanel.missingParticipant')}
            </div>
            <div className="flex items-center gap-2">
              <Check ok={!missing.includes('NO_STAGE')} />
              {t('publishPanel.missingStage')}
            </div>
            <div className="flex items-center gap-2">
              <Check ok={!missing.includes('STAGE_EMPTY')} />
              {t('publishPanel.missingStageRounds')}
            </div>
            <div className="flex items-center gap-2">
              <Check ok={!missing.includes('ROUND_EMPTY')} />
              {t('publishPanel.missingRoundPuzzles')}
            </div>
          </div>

          {/* "All stages have been added" is NOT verifiable — the system
              cannot know that the admin is done. The panel says what is
              true: "every existing stage is configured". It does not
              pretend to know more than that. */}
          <p className="mt-3 text-xs text-gray-500">
            {publishable
              ? t('publishPanel.allConfiguredHint')
              : t('publishPanel.someMissingHint')}
          </p>

          <div className="mt-4 pt-4 border-t flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {/* DRAFT → PUBLISHED: the Publish button is enabled iff the
                server says publishable. The server re-checks on click, so
                even a stale client cannot publish a broken competition. */}
            {isDraft && (
              <button
                onClick={handlePublish}
                disabled={!publishable || busy}
                className="px-4 sm:px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs sm:text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? t('common.loading') : t('publishPanel.publish')}
              </button>
            )}

            {/* PUBLISHED → DRAFT: the "Cancel publication" button. Destructive:
                destroys the access link so anyone who received it can no longer
                enter. Allowed only while the competition has not started. */}
            {isPublished && (
              <button
                onClick={handleCancel}
                disabled={busy}
                className="px-4 sm:px-6 py-2 border border-red-300 text-red-700 hover:bg-red-50 rounded-lg text-xs sm:text-sm font-medium disabled:opacity-50"
              >
                {busy ? t('common.loading') : t('publishPanel.cancel')}
              </button>
            )}

            {/* PUBLISHED + publishable → Start. If the admin added a stage
                after publishing, publishable is false and Start is disabled,
                even though the status column still says PUBLISHED. */}
            {isPublished && (
              <button
                onClick={handleStart}
                disabled={!publishable || busy || (canStart === false)}
                className="px-4 sm:px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-xs sm:text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? t('common.loading') : t('publishPanel.start')}
              </button>
            )}

            {isPublished && !publishable && (
              <p className="text-orange-600 text-xs sm:text-sm">
                {t('publishPanel.publishedButNotReady')}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
