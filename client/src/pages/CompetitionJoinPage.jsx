/**
 * CompetitionJoinPage — public entry page for competition participants.
 *
 * Resolves an access code to show competition info, then lets judges/players
 * log in to receive a competition-scoped JWT.
 *
 * The login goes through useAuth().competitionLogin so the session is
 * registered in AuthContext. Storing the token directly would leave `user`
 * null, and the PrivateRoute guarding /judge and /play would bounce the user
 * straight back to /login.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import LanguageSwitcher from '../components/LanguageSwitcher';

const STATUS_LABELS = {
  DRAFT: 'Draft',
  RUNNING: 'In Progress',
  FINISHED: 'Finished',
  PAUSED: 'Paused',
};

export default function CompetitionJoinPage() {
  const { accessCode } = useParams();
  const navigate = useNavigate();
  const { competitionLogin } = useAuth();

  const [info, setInfo] = useState(null);
  const [infoError, setInfoError] = useState('');
  const [loading, setLoading] = useState(true);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── Load competition info on mount ──
  useEffect(() => {
    api.getCompetitionByCode(accessCode).then((res) => {
      if (res.code === 200) {
        setInfo(res.data);
      } else {
        setInfoError(res.message || 'Competition not found');
      }
      setLoading(false);
    }).catch(() => {
      setInfoError('Failed to load competition info');
      setLoading(false);
    });
  }, [accessCode]);

  // ── Handle competition login ──
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setSubmitting(true);

    try {
      // Registers the session in AuthContext, so PrivateRoute lets us through.
      const session = await competitionLogin(accessCode, username, password);
      const target = session.role === 'JUDGE' ? 'judge' : 'play';
      navigate(`/${target}/${session.competitionId}`, { replace: true });
    } catch (err) {
      setLoginError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-800 flex items-center justify-center p-4">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  // ── Competition not found ──
  if (infoError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-800 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-8 w-full max-w-md border border-white/20 text-center">
          <div className="text-6xl mb-4">&#128533;</div>
          <h1 className="text-2xl font-bold text-white mb-2">Competition Not Found</h1>
          <p className="text-purple-200 mb-4">{infoError}</p>
          <p className="text-purple-300 text-sm">Please check your access link and try again.</p>
        </div>
      </div>
    );
  }

  // ── Entry page with login form ──
  const statusLabel = STATUS_LABELS[info.status] || info.status;
  const statusColor = {
    RUNNING: 'bg-green-500/80',
    DRAFT: 'bg-gray-500/80',
    FINISHED: 'bg-blue-500/80',
    PAUSED: 'bg-yellow-500/80',
  }[info.status] || 'bg-gray-500/80';

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-800 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-md border border-white/20">
        <div className="flex justify-end mb-2">
          <LanguageSwitcher />
        </div>

        {/* Competition info */}
        <div className="text-center mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">{info.name}</h1>
          {info.organizationName && (
            <p className="text-purple-200 text-sm mb-2">{info.organizationName}</p>
          )}
          <span className={`inline-block px-3 py-1 rounded-full text-white text-xs font-medium ${statusColor}`}>
            {statusLabel}
          </span>
        </div>

        {/* Login form */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm sm:text-base"
              required
            />
          </div>
          <div>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm sm:text-base"
              required
            />
          </div>

          {loginError && (
            <p className="text-red-300 text-xs sm:text-sm text-center">{loginError}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-semibold transition-colors text-sm sm:text-base"
          >
            {submitting ? 'Entering...' : 'Enter Competition'}
          </button>
        </form>

        <p className="text-purple-300 text-xs text-center mt-4">
          Use the credentials provided by your competition organizer.
        </p>
      </div>
    </div>
  );
}
