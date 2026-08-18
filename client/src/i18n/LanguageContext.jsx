// Le "serveur de menus" : mémorise la langue choisie, la sauvegarde dans le
// navigateur, et fournit la fonction t('login.title') pour lire le bon texte.
import { createContext, useContext, useState, useCallback } from 'react';
import zh from './zh';
import en from './en';

const dictionaries = { zh, en };
const STORAGE_KEY = 'sa_lang';

// Exporté pour les rares consommateurs qui doivent survivre à l'absence de
// fournisseur — typiquement l'interface de secours d'un garde-fou d'erreur, qui
// ne doit JAMAIS lever d'exception : une erreur dans l'affichage d'erreur fait
// disparaître toute l'application. Le code normal utilise useLanguage().
export const LanguageContext = createContext(null);

// Lit une clé "login.title" en profondeur dans un objet.
function resolve(dict, path) {
  return path.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), dict);
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    const saved = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
    return saved === 'en' || saved === 'zh' ? saved : 'zh'; // chinois par défaut
  });

  const changeLang = useCallback((next) => {
    setLang(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  const toggleLang = useCallback(() => {
    changeLang(lang === 'zh' ? 'en' : 'zh');
  }, [lang, changeLang]);

  // t('login.title') -> texte dans la langue courante.
  // t('game.correct', { pts: 10 }) remplace {pts} dans le texte.
  // Si la clé manque, on tente le chinois, sinon on renvoie la clé (pour repérer les oublis).
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
  if (!ctx) throw new Error('useLanguage doit être utilisé dans un <LanguageProvider>');
  return ctx;
}
