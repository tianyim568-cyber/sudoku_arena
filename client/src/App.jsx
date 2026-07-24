import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import TournamentListPage from './pages/TournamentListPage';
import TournamentDetailPage from './pages/TournamentDetailPage';
import PlayerGamePage from './pages/PlayerGamePage';
import JudgeControlPage from './pages/JudgeControlPage';
import PuzzleBankPage from './pages/PuzzleBankPage';

function PrivateRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen">加载中...</div>;
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
      <Route path="/" element={<PrivateRoute><TournamentListPage /></PrivateRoute>} />
      <Route path="/tournament/:id" element={<PrivateRoute><TournamentDetailPage /></PrivateRoute>} />
      <Route path="/play/:tournamentId" element={
        <PrivateRoute><RoleRoute roles={['PLAYER']}><PlayerGamePage /></RoleRoute></PrivateRoute>
      } />
      <Route path="/judge/:tournamentId" element={
        <PrivateRoute><RoleRoute roles={['JUDGE', 'ADMIN']}><JudgeControlPage /></RoleRoute></PrivateRoute>
      } />
      <Route path="/puzzle-bank" element={
        <PrivateRoute><RoleRoute roles={['ADMIN']}><PuzzleBankPage /></RoleRoute></PrivateRoute>
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
