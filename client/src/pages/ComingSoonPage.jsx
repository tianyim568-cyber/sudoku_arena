import { useLanguage } from '../i18n/LanguageContext';
import { useAuth } from '../hooks/useAuth';

// Generic placeholder for dashboard sections that have not been built yet.
// `titleKey` is one of the keys under `dashboard.nav.*` (e.g. "participants"),
// so the page title and the sidebar label always stay in sync.
//
// Phase 11: two optional props extend the component so it can also serve as
// the Super Admin waiting page without duplicating the layout:
//   - `messageKey` overrides the generic "Coming soon" subtitle with a more
//     specific key (e.g. "dashboard.superAdminComingSoon").
//   - `showLogout` renders a logout button — useful when the page is the
//     user's only destination and they need a way out.
export default function ComingSoonPage({ titleKey, messageKey, showLogout }) {
  const { t } = useLanguage();
  const { logout } = useAuth();
  return (
    <div className="flex flex-col items-center justify-center py-16 sm:py-24 text-center">
      <svg className="w-16 h-16 text-indigo-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <h1 className="text-xl sm:text-2xl font-bold text-gray-800 mb-2">
        {t(`dashboard.nav.${titleKey}`)}
      </h1>
      <p className="text-sm sm:text-base text-gray-500 max-w-md">
        {messageKey ? t(messageKey) : t('dashboard.comingSoon')}
      </p>
      {showLogout && (
        <button
          onClick={logout}
          className="mt-6 px-4 py-2 bg-gray-800 text-white rounded-md hover:bg-gray-900 text-sm"
        >
          {t('competitionList.logout')}
        </button>
      )}
    </div>
  );
}
