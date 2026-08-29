import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth, ADMIN_ROLES } from './hooks/useAuth';
import { useLanguage } from './i18n/LanguageContext';
import { ErrorBoundary } from './components/ErrorBoundary';
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
import DashboardResultsPage from './pages/DashboardResultsPage';
import DashboardJudgesPage from './pages/DashboardJudgesPage';
import DashboardParticipantsPage from './pages/DashboardParticipantsPage';
import AdminDashboardPage from './pages/AdminDashboardPage';
import DashboardTeamsPage from './pages/DashboardTeamsPage';
import ComingSoonPage from './pages/ComingSoonPage';
import ErrorPage from './pages/ErrorPage';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  if (loading) return <div className="flex items-center justify-center h-screen p-4 text-center text-sm sm:text-base">{t('common.loading')}</div>;
  if (!user) return <Navigate to="/login" />;
  return children;
}

// RoleRoute redirects to /403 instead of silently bouncing to "/". A judge
// who clicks an admin link must understand the refusal — not land on a page
// that pretends nothing happened. The /403 page explains the role mismatch
// and offers logout (the common fix when the user is in the wrong account).
function RoleRoute({ children, roles }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) return <Navigate to="/403" replace />;
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
            ? <Navigate to="/admin" replace />
            : ADMIN_ROLES.includes(user?.role)
              ? <Navigate to="/dashboard" replace />
              : <CompetitionListPage />}
        </PrivateRoute>
      } />
      {/* R11: Super Admin dashboard — platform-wide read-only overview (orgs,
          competitions, users). Replaces /admin-coming-soon. The router
          enforces SUPER_ADMIN on every route under /api/admin, so the page
          is safe to mount with a RoleRoute gate here. */}
      <Route path="/admin" element={
        <PrivateRoute><RoleRoute roles={['SUPER_ADMIN']}>
          <AdminDashboardPage />
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
        <Route path="participants" element={<DashboardParticipantsPage />} />
        <Route path="judges" element={<DashboardJudgesPage />} />
        <Route path="teams" element={<DashboardTeamsPage />} />
        <Route path="results" element={<DashboardResultsPage />} />
        {/* Safety net: an unknown /dashboard/* path would otherwise match no
            child and render a completely blank page. */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
      {/* Error pages. /403 is reached when RoleRoute refuses (a judge clicking
          an admin link); /404 is the catch-all for any unknown top-level path
          (a revoked display link, a stale bookmark); /500 is reserved for
          server-side errors surfaced client-side. Each page offers a door out
          — a dead end is no better than a blank page. */}
      <Route path="/403" element={<ErrorPage status={403} />} />
      <Route path="/500" element={<ErrorPage status={500} />} />
      {/* The top-level catch-all. Must come AFTER every other route — React
          Router scores `*` lowest, so declared routes still win. Before this,
          an unknown address silently matched nothing and rendered blank. */}
      <Route path="*" element={<ErrorPage status={404} />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      {/* The global boundary is the safety net: any render exception that
          escapes a local boundary (or that occurs in a page without one)
          lands here instead of blanking the whole app. It does NOT catch
          event-handler or async errors — those are documented limits. */}
      <ErrorBoundary>
        <AppRoutes />
      </ErrorBoundary>
    </AuthProvider>
  );
}
