// Le petit bouton de bascule de langue 中文 / EN.
import { useLanguage } from '../i18n/LanguageContext';

export default function LanguageSwitcher({ className = '' }) {
  const { lang, toggleLang } = useLanguage();

  return (
    <button
      type="button"
      onClick={toggleLang}
      // Affiche la langue vers laquelle on va basculer.
      aria-label="Switch language"
      className={`px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-medium transition-colors ${className}`}
    >
      {lang === 'zh' ? 'EN' : '中文'}
    </button>
  );
}
