// The "menu server": remembers the picked language, saves it to the
// browser, and hands t('login.title') to the tree.
import { createContext, useContext, useState, useCallback } from 'react';
import zh from './zh';
import en from './en';

const dictionaries = { zh, en };
const STORAGE_KEY = 'sa_lang';

// Exported for the rare consumers that must survive the absence of a
// provider — typically an error boundary's fallback UI, which must NEVER
// throw: an exception thrown while rendering an error would blank the
// whole app. Regular code uses useLanguage() instead.
export const LanguageContext = createContext(null);

// Read a dotted key ("login.title") deep in the dictionary object.
function resolve(dict, path) {
  return path.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), dict);
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    const saved = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
    return saved === 'en' || saved === 'zh' ? saved : 'zh'; // Chinese is the default.
  });

  const changeLang = useCallback((next) => {
    setLang(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const toggleLang = useCallback(() => {
    changeLang(lang === 'zh' ? 'en' : 'zh');
  }, [lang, changeLang]);

  // t('login.title') → the string in the current language.
  // t('game.correct', { pts: 10 }) substitutes {pts} in the string.
  // On a missing key, fall back to Chinese; if still missing, return the
  // key itself so misses are visible in the UI rather than blank.
  const t = useCallback((key, params) => {
    const value = resolve(dictionaries[lang], key);
    let str = value != null ? value : resolve(dictionaries.zh, key);
    if (str == null) return key;
    if (params && typeof str === 'string') {
      str = str.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
    }
    return str;
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang: changeLang, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside a <LanguageProvider>');
  return ctx;
}
