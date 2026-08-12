import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useLanguage } from './i18n/LanguageContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import TournamentListPage from './pages/TournamentListPage';
import TournamentDetailPage from './pages/TournamentDetailPage';
import PlayerGamePage from './pages/PlayerGamePage';
import JudgeControlPage from './pages/JudgeControlPage';
import PuzzleBankPage from './pages/PuzzleBankPage';
import CompetitionJoinPage from './pages/CompetitionJoinPage';
import DisplayPage from './pages/DisplayPage';

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
      <Route path="/competition/:accessCode" element={<CompetitionJoinPage />} />
      <Route path="/display/:token" element={<DisplayPage />} />
      <Route path="/" element={<PrivateRoute><TournamentListPage /></PrivateRoute>} />
      <Route path="/tournament/:id" element={<PrivateRoute><TournamentDetailPage /></PrivateRoute>} />
      <Route path="/play/:tournamentId" element={
        <PrivateRoute><RoleRoute roles={['PLAYER']}><PlayerGamePage /></RoleRoute></PrivateRoute>
      } />
      <Route path="/judge/:tournamentId" element={
        <PrivateRoute><RoleRoute roles={['JUDGE']}><JudgeControlPage /></RoleRoute></PrivateRoute>
      } />
      <Route path="/puzzle-bank" element={
        <PrivateRoute><RoleRoute roles={['ORG_ADMIN']}><PuzzleBankPage /></RoleRoute></PrivateRoute>
      } />
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
