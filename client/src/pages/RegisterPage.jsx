import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import LanguageSwitcher from '../components/LanguageSwitcher';

export default function RegisterPage() {
  const [organizationName, setOrganizationName] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { registerAndLogin } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const validate = () => {
    if (!organizationName.trim()) return t('register.orgNameRequired');
    if (organizationName.trim().length < 2) return t('register.orgNameTooShort');
    if (!adminUsername.trim()) return t('register.adminRequired');
    if (!password) return t('register.passwordRequired');
    if (password.length < 6) return t('register.passwordTooShort');
    if (password !== confirmPassword) return t('register.passwordMismatch');
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      await registerAndLogin(organizationName.trim(), adminUsername.trim(), password);
      navigate('/');
    } catch (err) {
      setError(err.message || t('register.failed'));
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-800 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-6 sm:p-8 w-full max-w-md border border-white/20">
        <div className="flex justify-end mb-2">
          <LanguageSwitcher />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white text-center mb-2">{t('register.title')}</h1>
        <p className="text-purple-200 text-center mb-6 sm:mb-8 text-sm sm:text-base">{t('register.subtitle')}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text"
              placeholder={t('register.organizationName')}
              value={organizationName}
              onChange={e => setOrganizationName(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm sm:text-base"
            />
          </div>
          <div>
            <input
              type="text"
              placeholder={t('register.adminUsername')}
              value={adminUsername}
              onChange={e => setAdminUsername(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm sm:text-base"
            />
          </div>
          <div>
            <input
              type="password"
              placeholder={t('register.password')}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm sm:text-base"
            />
          </div>
          <div>
            <input
              type="password"
              placeholder={t('register.confirmPassword')}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm sm:text-base"
            />
          </div>
          {error && <p className="text-red-300 text-xs sm:text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-5 disabled:cursor-not-allowed text-white font-semibold transition-colors text-sm sm:text-base"
          >
            {submitting ? t('common.loading') : t('register.submit')}
          </button>
        </form>

        <div className="mt-6 border-t border-white/20 pt-4 text-center">
          <Link to="/login" className="text-purple-300 hover:text-white text-xs sm:text-sm transition-colors">
            {t('register.linkToLogin')}
          </Link>
        </div>
      </div>
    </div>
  );
}
