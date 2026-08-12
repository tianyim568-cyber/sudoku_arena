import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(err.message || t('login.failed'));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-800 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-md border border-white/20">
        <div className="flex justify-end mb-2">
          <LanguageSwitcher />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white text-center mb-2">{t('login.title')}</h1>
        <p className="text-purple-200 text-center mb-6 sm:mb-8 text-sm sm:text-base">{t('login.subtitle')}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text" placeholder={t('login.username')} value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm sm:text-base"
            />
          </div>
          <div>
            <input
              type="password" placeholder={t('login.password')} value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm sm:text-base"
            />
          </div>
          {error && <p className="text-red-300 text-xs sm:text-sm text-center">{error}</p>}
          <button
            type="submit"
            className="w-full py-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors text-sm sm:text-base"
          >
            {t('login.submit')}
          </button>
        </form>

        <div className="mt-4 text-center">
          <Link to="/register" className="text-purple-300 hover:text-white text-xs sm:text-sm transition-colors">
            {t('login.linkToRegister')}
          </Link>
        </div>
      </div>
    </div>
  );
}
