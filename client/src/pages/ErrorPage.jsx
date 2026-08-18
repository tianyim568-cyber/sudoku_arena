/**
 * ErrorPage — the shared layout for 404 / 403 / 500 pages.
 *
 * One component, three flavours: the structure is identical (an icon, a
 * title, a short explanation, and at least one door out). Only the copy and
 * the icon differ. A page that gives no way out is not much better than a
 * blank page — Louise's explicit ask.
 *
 * Doors out, by status:
 *   - 404 NOT FOUND:    back to home (the user is lost — give them the
 *                        ground floor)
 *   - 403 FORBIDDEN:    back to home + a line that says WHY (role). A judge
 *                        who clicks an admin link must understand the refusal,
 *                        not be told "error".
 *   - 500 SERVER ERROR: "try again" button (reload). No back-home button —
 *                        a 500 is transient, retry is the right move.
 *
 * The 403 page also offers a logout link, because the most common 403 cause
 * here is a role mismatch the user can only resolve by switching accounts.
 *
 * Public vs private: 404 and 500 can be hit by anyone (a revoked display
 * link is a 404 for an unauthenticated visitor). 403 only makes sense for
 * an authenticated user, but the page renders fine either way — the "back
 * home" link points to "/" which redirects to /login if not authed.
 */
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { useAuth } from '../hooks/useAuth';

const ICONS = {
  404: (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  ),
  403: (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
  ),
  500: (
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  ),
};

export default function ErrorPage({ status }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const title = t(`errors.title${status}`);
  const message = t(`errors.message${status}`);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-16 text-center">
      <svg className="w-20 h-20 text-gray-400 mb-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {ICONS[status]}
      </svg>
      <p className="text-5xl sm:text-6xl font-bold text-gray-800 mb-2">{status}</p>
      <h1 className="text-lg sm:text-xl font-semibold text-gray-700 mb-3">{title}</h1>
      <p className="text-sm sm:text-base text-gray-500 max-w-md mb-8">{message}</p>

      <div className="flex flex-col sm:flex-row items-center gap-3">
        {status !== 500 && (
          <button
            onClick={() => navigate('/')}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium"
          >
            {t('errors.backHome')}
          </button>
        )}
        {status === 500 && (
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium"
          >
            {t('errors.retry')}
          </button>
        )}
        {status === 403 && user && (
          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="px-5 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-lg text-sm font-medium"
          >
            {t('errors.switchAccount')}
          </button>
        )}
        {status === 403 && !user && (
          <button
            onClick={() => navigate('/login')}
            className="px-5 py-2 border border-gray-300 text-gray-700 hover:bg-gray-100 rounded-lg text-sm font-medium"
          >
            {t('errors.backToLogin')}
          </button>
        )}
      </div>
    </div>
  );
}
