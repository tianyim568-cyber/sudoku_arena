import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(err.message || '登录失败');
    }
  };

  const quickLogin = async (u, p) => {
    setUsername(u);
    setPassword(p);
    try {
      await login(u, p);
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-800 flex items-center justify-center p-4">
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-8 w-full max-w-md border border-white/20">
        <h1 className="text-3xl font-bold text-white text-center mb-2">数独竞技场</h1>
        <p className="text-purple-200 text-center mb-8">实时多人竞技</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <input
              type="text" placeholder="用户名" value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>
          <div>
            <input
              type="password" placeholder="密码" value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>
          {error && <p className="text-red-300 text-sm text-center">{error}</p>}
          <button
            type="submit"
            className="w-full py-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors"
          >
            登录
          </button>
        </form>

        <div className="mt-6 border-t border-white/20 pt-4">
          <p className="text-purple-300 text-sm text-center mb-3">快速登录（演示）</p>
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => quickLogin('admin', 'admin123')}
              className="py-2 px-3 rounded bg-amber-600/80 hover:bg-amber-500 text-white text-xs font-medium transition-colors">
              管理员
            </button>
            <button onClick={() => quickLogin('judge', 'judge123')}
              className="py-2 px-3 rounded bg-blue-600/80 hover:bg-blue-500 text-white text-xs font-medium transition-colors">
              裁判
            </button>
            <button onClick={() => quickLogin('player1', 'player123')}
              className="py-2 px-3 rounded bg-green-600/80 hover:bg-green-500 text-white text-xs font-medium transition-colors">
              选手1
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
