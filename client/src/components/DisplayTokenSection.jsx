/**
 * DisplayTokenSection — admin block to generate, copy, and revoke the
 * big-screen display token for a competition.
 *
 * The server exposes two routes: POST to generate, DELETE to revoke. There is
 * **no GET** to retrieve an existing token — the field lives on the competition
 * row, but the server never returns it in clear text after creation. So unlike
 * AccessLinkSection (which starts in LOADING then settles to NO_LINK or LINK),
 * this component starts in NO_TOKEN: we do not know whether a token already
 * exists, and we must not find out by calling generate (that would revoke and
 * replace the token — cutting any screen currently wired up in the room).
 *
 * The practical consequence: on first render the admin sees a "Generate"
 * button. If a token was already generated in a previous session, that button
 * is the only way to surface a URL again — and clicking it does revoke the old
 * one. The confirm dialog gates this destructive case.
 *
 * Three states:
 *
 *   - NO_TOKEN — no token in memory. Show "Generate". The first click does NOT
 *                 confirm: there is nothing to revoke. The server creates a
 *                 fresh token, we store it, and we switch to LINK.
 *   - LINK     — a token is in memory. Show the URL, a "Copy" button, and a
 *                 "Revoke" button. Revoke is destructive (cuts the screen in
 *                 the room) → confirm dialog before the API call.
 *   - ERROR    — a request failed. Show the message, keep the buttons usable.
 *
 * Visibility: the parent renders this only when isAdmin is true (ORG_ADMIN or
 * SUPER_ADMIN), which matches the server's roleMiddleware on the display-token
 * routes. A judge on this page never sees the block.
 *
 * Why this is not factorized with AccessLinkSection: the contracts differ
 * (access-link has a GET, display-token does not), and the destructive action
 * is "revoke" (permanent) here vs "regenerate" (replace) for access-link.
 * Same motif, two components — see JOURNAL_MODIFICATIONS.md for the reasoning.
 */
import { useState, useCallback } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { api } from '../api';

export default function DisplayTokenSection({ competitionId }) {
  const { t } = useLanguage();
  // token is null until the admin generates one. We never know whether the
  // server already has one — see the component doc for why.
  const [token, setToken] = useState(null); // { token, displayUrl } | null
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await api.generateDisplayToken(competitionId);
    setBusy(false);
    if (res.code === 200) {
      setToken(res.data);
      setCopied(false);
    } else {
      setError(res.message || t('displayToken.generateFailed'));
    }
  }, [competitionId, t]);

  const handleRevoke = useCallback(async () => {
    // Revoking cuts any screen currently wired up in the room. A stray click
    // must not do that — the admin has to confirm explicitly. We confirm even
    // when token is null (paranoid: if the admin generated one in a previous
    // session and lost the page, the server still has one).
    if (!window.confirm(t('displayToken.revokeConfirm'))) return;
    setBusy(true);
    setError(null);
    const res = await api.revokeDisplayToken(competitionId);
    setBusy(false);
    if (res.code === 200) {
      setToken(null);
      setCopied(false);
    } else {
      setError(res.message || t('displayToken.revokeFailed'));
    }
  }, [competitionId, t]);

  const handleCopy = useCallback(async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token.displayUrl);
      setCopied(true);
      // Reset the "copied" hint after a couple of seconds so the admin can
      // copy again later and still get feedback.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API can be unavailable (insecure context, old browser).
      setError(t('displayToken.copyFailed'));
    }
  }, [token, t]);

  const hasToken = !!(token && token.token && token.displayUrl);

  return (
    <section className="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 className="text-base sm:text-lg font-semibold mb-3">
        {t('displayToken.title')}
      </h2>

      {!hasToken && (
        <div className="space-y-3">
          <p className="text-gray-500 text-xs sm:text-sm">{t('displayToken.noneYet')}</p>
          <button
            onClick={handleGenerate}
            disabled={busy}
            className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs sm:text-sm hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? t('common.loading') : t('displayToken.generate')}
          </button>
          {/* Revoke is shown even without a token in memory: the server may
              still hold one from a previous session. The confirm dialog
              protects against accidents. */}
          <button
            onClick={handleRevoke}
            disabled={busy}
            className="ml-2 px-3 py-1.5 border border-red-300 text-red-600 rounded text-xs sm:text-sm hover:bg-red-50 disabled:opacity-50"
          >
            {busy ? t('common.loading') : t('displayToken.revoke')}
          </button>
          {error && <p className="text-red-600 text-xs sm:text-sm">{error}</p>}
        </div>
      )}

      {hasToken && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <code className="block flex-1 bg-gray-50 border rounded px-3 py-2 text-xs sm:text-sm font-mono break-all">
              {token.displayUrl}
            </code>
            <button
              onClick={handleCopy}
              disabled={busy}
              className="px-3 py-1.5 bg-gray-700 text-white rounded text-xs sm:text-sm hover:bg-gray-600 disabled:opacity-50 whitespace-nowrap"
            >
              {copied ? t('displayToken.copied') : t('displayToken.copy')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleRevoke}
              disabled={busy}
              className="px-3 py-1.5 border border-red-300 text-red-600 rounded text-xs sm:text-sm hover:bg-red-50 disabled:opacity-50"
            >
              {busy ? t('common.loading') : t('displayToken.revoke')}
            </button>
          </div>
          {error && <p className="text-red-600 text-xs sm:text-sm">{error}</p>}
        </div>
      )}
    </section>
  );
}
