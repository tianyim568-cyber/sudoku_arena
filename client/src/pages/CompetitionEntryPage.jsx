import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';

// Until the server can give us the real competition name, derive a readable
// title from the URL slug: "test-competition-2026" -> "Test Competition 2026".
function prettifyIdentifier(slug) {
  if (!slug) return '';
  return slug
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\p{Ll}/gu, c => c.toUpperCase());
}

export default function CompetitionEntryPage() {
  const { identifier } = useParams();
  const navigate = useNavigate();
  const { competitionLogin } = useAuth();
  const { t } = useLanguage();

  const [competitionName, setCompetitionName] = useState(null);
  const [infoError, setInfoError] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fetching the real competition name is a bonus, never a gate: the form is
  // rendered immediately with the slug-derived title and the name is swapped in
  // if the server answers. Ignore a late answer if the identifier changed.
  useEffect(() => {
    let cancelled = false;
    api.getCompetitionInfo(identifier)
      .then(res => {
        if (cancelled) return;
        if (res.code === 200 && res.data?.name) setCompetitionName(res.data.name);
        else setInfoError(true);
      })
      .catch(() => { if (!cancelled) setInfoError(true); });
    return () => { cancelled = true; };
  }, [identifier]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      // Registers the session in AuthContext, so PrivateRoute lets us through.
      const session = await competitionLogin(identifier, username, password);
      const target = session.role === 'JUDGE' || session.role === 'ADMIN' ? 'judge' : 'play';
      navigate(`/${target}/${session.competitionId}`, { replace: true });
    } catch (err) {
      if (err.code === 404) {
        // The competition login endpoint does not exist yet (server side).
        setError(t('competition.endpointUnavailable'));
      } else {
        setError(err.message || t('competition.failed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-indigo-900 to-purple-800 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-md border border-white/20">
        <div className="flex justify-end mb-2">
          <LanguageSwitcher />
        </div>

        <h1 className="text-xl sm:text-2xl font-bold text-white text-center mb-1 break-words leading-snug">
          {competitionName || prettifyIdentifier(identifier)}
        </h1>
        <p className="text-blue-200 text-center mb-6 sm:mb-8 text-sm sm:text-base">
          {t('competition.title')}
        </p>

        {infoError && (
          <div className="bg-yellow-500/20 border border-yellow-400/30 rounded-lg p-3 mb-4 text-yellow-200 text-xs sm:text-sm text-center">
            {t('competition.endpointUnavailable')}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              placeholder={t('competition.username')}
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm sm:text-base"
            />
          </div>
          <div>
            <input
              type="password"
              placeholder={t('competition.password')}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm sm:text-base"
            />
          </div>
          {error && <p className="text-red-300 text-xs sm:text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold transition-colors text-sm sm:text-base"
          >
            {submitting ? t('competition.loggingIn') : t('competition.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
