import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLanguage } from '../i18n/LanguageContext';
import LanguageSwitcher from './LanguageSwitcher';

// Sidebar navigation items. `to` matches the /dashboard/* route group.
// All sections now resolve to a real route: puzzle-bank, participants,
// judges, teams and results each have a child route in App.jsx (the four
// unbuilt ones render a ComingSoonPage placeholder, so the sidebar stays
// consistent instead of mixing active links with disabled labels).
const NAV_ITEMS = [
  { key: 'dashboard', to: '/dashboard', end: true },
  { key: 'competitions', to: '/dashboard/competitions', end: false },
  { key: 'puzzleBank', to: '/dashboard/puzzle-bank', end: false },
  { key: 'participants', to: '/dashboard/participants', end: false },
  { key: 'judges', to: '/dashboard/judges', end: false },
  { key: 'teams', to: '/dashboard/teams', end: false },
  { key: 'results', to: '/dashboard/results', end: false },
];

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Active link style: indigo background, white text.
  // Inactive: transparent with hover.
  const linkClass = ({ isActive }) =>
    `flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-indigo-600 text-white'
        : 'text-indigo-100 hover:bg-indigo-500/30'
    }`;

  return (
    // Full-height app shell: header on top, then a sidebar + content row that
    // fills the rest. The row (not the page) scrolls, so the sidebar never needs
    // a hardcoded header offset.
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header — spans the full window width so it lines up with the sidebar */}
      <header className="bg-gradient-to-r from-indigo-700 to-purple-700 text-white px-4 sm:px-6 py-4 shadow-lg shrink-0 z-20">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* Mobile sidebar toggle */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-white/10 transition-colors"
              aria-label="Toggle sidebar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg sm:text-xl font-bold">{t('dashboard.appTitle')}</h1>
              <p className="text-purple-200 text-xs hidden sm:block">
                {user?.displayName} ({user?.role})
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <LanguageSwitcher />
            <button
              onClick={handleLogout}
              className="px-3 sm:px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs sm:text-sm transition-colors"
            >
              {t('tournamentList.logout')}
            </button>
          </div>
        </div>
      </header>

      {/* `relative` anchors the mobile drawer to this row, so it sits below the
          header instead of covering it. `min-h-0` lets the children scroll. */}
      <div className="flex flex-1 min-h-0 relative">
        {/* Sidebar — flush to the window edge; a drawer on mobile, in-flow on lg */}
        <aside
          className={`${
            sidebarOpen ? 'block' : 'hidden'
          } lg:block absolute lg:static inset-y-0 left-0 z-30 w-56 shrink-0 bg-indigo-800 text-white p-4 overflow-y-auto`}
        >
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.key}
                to={item.to}
                end={item.end}
                onClick={() => setSidebarOpen(false)}
                className={linkClass}
              >
                {t(`dashboard.nav.${item.key}`)}
              </NavLink>
            ))}
          </nav>
        </aside>

        {/* Backdrop on mobile when sidebar is open */}
        {sidebarOpen && (
          <div
            className="lg:hidden absolute inset-0 bg-black/30 z-20"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main content area — scrolls on its own; inner cap keeps text readable
            on wide screens without pushing the sidebar off the window edge. */}
        <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
