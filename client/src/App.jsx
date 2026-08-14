import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth, ADMIN_ROLES } from './hooks/useAuth';
import { useLanguage } from './i18n/LanguageContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import CompetitionListPage from './pages/CompetitionListPage';
import CompetitionDetailPage from './pages/CompetitionDetailPage';
import PlayerGamePage from './pages/PlayerGamePage';
import JudgeControlPage from './pages/JudgeControlPage';
import CompetitionJoinPage from './pages/CompetitionJoinPage';
import DisplayPage from './pages/DisplayPage';
import DashboardLayout from './components/DashboardLayout';
import DashboardCompetitionsPage from './pages/DashboardCompetitionsPage';
import DashboardPuzzleBankPage from './pages/DashboardPuzzleBankPage';
import DashboardPage from './pages/DashboardPage';
import ComingSoonPage from './pages/ComingSoonPage';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  if (loading) return <div className="flex items-center justify-center h-screen p-4 text-center text-sm sm:text-base">{t('common.loading')}</div>;
  if (!user) return <Navigate to="/login" />;
  return children;
}

function RoleRoute({ children, roles }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) return <Navigate to="/" />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />
      <Route path="/register" element={user ? <Navigate to="/" /> : <RegisterPage />} />
      {/* Two distinct routes live under the "competition" noun, and they must not
          collide. Singular /competition/:accessCode is the PUBLIC entry link
          handed to judges and players — the server builds it in
          routes/competitions.js (buildEntryUrl), so this path is externally
          distributed and cannot change. Plural /competitions/:id below is the
          admin-only detail page. Both were briefly declared as
          /competition/:param, which React Router scores identically: the first
          declaration won and the detail page became unreachable. */}
      <Route path="/competition/:accessCode" element={<CompetitionJoinPage />} />
      <Route path="/display/:token" element={<DisplayPage />} />
      {/* Admins manage from the dashboard; judges and players keep the plain list.
          Redirecting here (rather than in LoginPage) also covers returning users
          who land on "/" with a stored token. */}
      <Route path="/" element={
        <PrivateRoute>
          {user?.role === 'SUPER_ADMIN'
            ? <Navigate to="/admin-coming-soon" replace />
            : ADMIN_ROLES.includes(user?.role)
              ? <Navigate to="/dashboard" replace />
              : <CompetitionListPage />}
        </PrivateRoute>
      } />
      {/* Phase 11: Super Admin landing page. The platform-admin interface is not
          built yet (Appendix A, P2). Routing SUPER_ADMIN here instead of
          /dashboard avoids showing them a mixed-org competition list. */}
      <Route path="/admin-coming-soon" element={
        <PrivateRoute><RoleRoute roles={['SUPER_ADMIN']}>
          <ComingSoonPage titleKey="superAdmin" messageKey="dashboard.superAdminComingSoon" showLogout />
        </RoleRoute></PrivateRoute>
      } />
      {/* Plural: the admin detail page. See the note on /competition/:accessCode. */}
      <Route path="/competitions/:id" element={<PrivateRoute><CompetitionDetailPage /></PrivateRoute>} />
      <Route path="/play/:competitionId" element={
        <PrivateRoute><RoleRoute roles={['PLAYER']}><PlayerGamePage /></RoleRoute></PrivateRoute>
      } />
      <Route path="/judge/:competitionId" element={
        <PrivateRoute><RoleRoute roles={['JUDGE']}><JudgeControlPage /></RoleRoute></PrivateRoute>
      } />
      {/* Puzzle Bank used to live at /puzzle-bank as a standalone page. It is
          now a dashboard section (/dashboard/puzzle-bank), so old links and
          bookmarks redirect to the new in-dashboard location. */}
      <Route path="/puzzle-bank" element={<Navigate to="/dashboard/puzzle-bank" replace />} />
      {/* Dashboard route group — admin-only, uses DashboardLayout with sidebar */}
      <Route path="/dashboard" element={
        <PrivateRoute><RoleRoute roles={ADMIN_ROLES}><DashboardLayout /></RoleRoute></PrivateRoute>
      }>
        <Route index element={<DashboardPage />} />
        <Route path="competitions" element={<DashboardCompetitionsPage />} />
        <Route path="puzzle-bank" element={<DashboardPuzzleBankPage />} />
        {/* Placeholder pages for sections not yet built. They use the same
            ComingSoonPage component with a different title key, so the page
            heading always matches the sidebar label. */}
        <Route path="participants" element={<ComingSoonPage titleKey="participants" />} />
        <Route path="judges" element={<ComingSoonPage titleKey="judges" />} />
        <Route path="teams" element={<ComingSoonPage titleKey="teams" />} />
        <Route path="results" element={<ComingSoonPage titleKey="results" />} />
        {/* Safety net: an unknown /dashboard/* path would otherwise match no
            child and render a completely blank page. */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
