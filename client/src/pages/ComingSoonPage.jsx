import { useLanguage } from '../i18n/LanguageContext';

// Generic placeholder for dashboard sections that have not been built yet.
// `titleKey` is one of the keys under `dashboard.nav.*` (e.g. "participants"),
// so the page title and the sidebar label always stay in sync.
export default function ComingSoonPage({ titleKey }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center py-16 sm:py-24 text-center">
      <svg className="w-16 h-16 text-indigo-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <h1 className="text-xl sm:text-2xl font-bold text-gray-800 mb-2">
        {t(`dashboard.nav.${titleKey}`)}
      </h1>
      <p className="text-sm sm:text-base text-gray-500">
        {t('dashboard.comingSoon')}
      </p>
    </div>
  );
}
