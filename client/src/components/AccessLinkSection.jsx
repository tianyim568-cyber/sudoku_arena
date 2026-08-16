/**
 * AccessLinkSection — admin block to view, copy, and (re)generate the player
 * entry link for a competition.
 *
 * The server already knows how to generate, read, and revoke the code; this
 * component is the missing UI. Three states matter:
 *
 *   - LOADING   — the GET is in flight. Avoid flashing "no link" before the
 *                 answer arrives: the admin would see a "Generate" button
 *                 appear and disappear, and might click it thinking there is
 *                 no link when one exists.
 *   - NO_LINK   — the competition has no access code yet. Not an error: a
 *                 brand-new competition has none. Show a "Generate" button.
 *   - LINK      — the code exists. Show the URL, a "Copy" button, and a
 *                 "Regenerate" button. Regeneration invalidates the old URL:
 *                 anyone who received it cannot enter anymore. That is a
 *                 destructive, distributed action, so it requires a confirm
 *                 dialog — a stray click must not revoke a link that was
 *                 already sent to a hundred players.
 *
 * Visibility: the parent renders this only for ORG_ADMIN / SUPER_ADMIN, which
 * matches the server's roleMiddleware on the access-link routes. A judge on
 * this page never sees the block, so they never hit a 403.
 *
 * Copy: uses navigator.clipboard.writeText so the admin does not have to
 * select the URL manually (fiddly on mobile, error-prone on desktop).
 */
import { useEffect, useState, useCallback } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

/**
 * @param {string}  competitionId
 * @param {boolean} canGenerate — is the competition published? Publishing does
 *   not create the link, it UNLOCKS creating one: an unpublished competition
 *   has an unfinished configuration, and handing out an entry URL for it would
 *   invite people into something still being built. The server enforces this
 *   (POST /:id/access-link answers 40041 on a DRAFT); this flag only spares the
 *   admin a button that would refuse. Never the other way round.
 */
export default function AccessLinkSection({ competitionId, canGenerate = false }) {
  const { t } = useLanguage();
  const [link, setLink] = useState(null); // { accessCode, entryUrl } | null
  const [status, setStatus] = useState('LOADING'); // LOADING | READY | ERROR
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false); // disables buttons during a request
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setStatus('LOADING');
    setError(null);
    const res = await api.getAccessLink(competitionId);
    if (res.code === 200) {
      setLink(res.data); // data is { accessCode, entryUrl } with entryUrl null if no code
      setStatus('READY');
    } else {
      setError(res.message || t('accessLink.loadFailed'));
      setStatus('ERROR');
    }
  }, [competitionId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const hasLink = !!(link && link.accessCode && link.entryUrl);

  const handleGenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await api.generateAccessLink(competitionId);
    setBusy(false);
    if (res.code === 200) {
      setLink(res.data);
      setCopied(false);
    } else {
      setError(res.message || t('accessLink.generateFailed'));
    }
  }, [competitionId, t]);

  const handleRegenerate = useCallback(async () => {
    // Regeneration revokes the old link everywhere it was distributed. A
    // stray click must not do that — the admin has to confirm explicitly.
    if (!window.confirm(t('accessLink.regenerateConfirm'))) return;
    await handleGenerate();
  }, [handleGenerate, t]);

  const handleCopy = useCallback(async () => {
    if (!hasLink) return;
    try {
      await navigator.clipboard.writeText(link.entryUrl);
      setCopied(true);
      // Reset the "copied" hint after a couple of seconds so the admin can
      // copy again later and still get feedback.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API can be unavailable (insecure context, old browser).
      // Fall back to selecting the URL field so the admin can Ctrl+C.
      setError(t('accessLink.copyFailed'));
    }
  }, [hasLink, link, t]);

  return (
    <section className="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 className="text-base sm:text-lg font-semibold mb-3">
        {t('accessLink.title')}
      </h2>

      {status === 'LOADING' && (
        <p className="text-gray-400 text-xs sm:text-sm">{t('common.loading')}</p>
      )}

      {status === 'ERROR' && (
        <p className="text-red-600 text-xs sm:text-sm">{error}</p>
      )}

      {status === 'READY' && !hasLink && (
        <div className="space-y-3">
          <p className="text-gray-500 text-xs sm:text-sm">{t('accessLink.noneYet')}</p>
          {/* A disabled button says "not yet"; a missing button says "never".
              The admin needs the first: the link IS coming, once published. */}
          <button
            onClick={handleGenerate}
            disabled={busy || !canGenerate}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs sm:text-sm hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? t('common.loading') : t('accessLink.generate')}
          </button>
          {!canGenerate && (
            <p className="text-gray-500 text-xs sm:text-sm">{t('accessLink.publishFirst')}</p>
          )}
          {error && <p className="text-red-600 text-xs sm:text-sm">{error}</p>}
        </div>
      )}

      {status === 'READY' && hasLink && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <code className="block flex-1 bg-gray-50 border rounded px-3 py-2 text-xs sm:text-sm font-mono break-all">
              {link.entryUrl}
            </code>
            <button
              onClick={handleCopy}
              disabled={busy}
              className="px-3 py-1.5 bg-gray-700 text-white rounded text-xs sm:text-sm hover:bg-gray-600 disabled:opacity-50 whitespace-nowrap"
            >
              {copied ? t('accessLink.copied') : t('accessLink.copy')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleRegenerate}
              disabled={busy}
              className="px-3 py-1.5 border border-red-300 text-red-600 rounded text-xs sm:text-sm hover:bg-red-50 disabled:opacity-50"
            >
              {busy ? t('common.loading') : t('accessLink.regenerate')}
            </button>
          </div>
          {error && <p className="text-red-600 text-xs sm:text-sm">{error}</p>}
        </div>
      )}
    </section>
  );
}
