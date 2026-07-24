import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../api';

export default function TournamentListPage() {
  const { user, logout } = useAuth();
  const [tournaments, setTournaments] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [statusMsg, setStatusMsg] = useState(null);
  const navigate = useNavigate();

  const load = async () => {
    const res = await api.listTournaments();
    if (res.code === 200) setTournaments(res.data);
  };

  const msg = (text, type = 'info') => {
    setStatusMsg({ text, type });
    setTimeout(() => setStatusMsg(null), 4000);
  };

  const handleDelete = async (e, tournamentId, tournamentName) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`确定要删除 "${tournamentName}" 吗？此操作无法撤销。`)) return;
    const res = await api.deleteTournament(tournamentId);
    if (res.code === 200) {
      msg(`"${tournamentName}" 已删除`);
      load();
    } else {
      msg(res.message || '删除失败', 'error');
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    const res = await api.createTournament({ name, description });
    if (res.code === 200) {
      setShowCreate(false);
      setName('');
      setDescription('');
      load();
    }
  };

  const statusColor = {
    PENDING: 'bg-yellow-100 text-yellow-800',
    IN_PROGRESS: 'bg-green-100 text-green-800',
    PAUSED: 'bg-orange-100 text-orange-800',
    FINISHED: 'bg-gray-100 text-gray-800',
  };

  const statusLabel = {
    PENDING: '未开始',
    IN_PROGRESS: '进行中',
    PAUSED: '已暂停',
    FINISHED: '已结束',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-indigo-700 to-purple-700 text-white px-6 py-4 shadow-lg">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">数独竞技场</h1>
            <p className="text-purple-200 text-sm">{user?.displayName} ({user?.role})</p>
          </div>
          <div className="flex items-center gap-3">
            {user?.role === 'ADMIN' && (
              <button onClick={() => navigate('/puzzle-bank')}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition-colors">
                题库
              </button>
            )}
            <button onClick={logout} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition-colors">
              退出登录
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6">
        {statusMsg && (
          <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
            statusMsg.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' :
            'bg-green-50 text-green-700 border border-green-200'
          }`}>{statusMsg.text}</div>
        )}

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-gray-800">赛事列表</h2>
          {user?.role === 'ADMIN' && (
            <button onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors">
              + 新建赛事
            </button>
          )}
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="bg-white rounded-xl shadow p-6 mb-6 space-y-4">
            <input type="text" placeholder="赛事名称" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" required />
            <textarea placeholder="简介（可选）" value={description} onChange={e => setDescription(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" rows={2} />
            <div className="flex gap-2">
              <button type="submit" className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm">创建</button>
              <button type="button" onClick={() => setShowCreate(false)} className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">取消</button>
            </div>
          </form>
        )}

        {tournaments.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg">暂无赛事</p>
            {user?.role === 'ADMIN' && <p className="text-sm mt-2">点击 "+ 新建赛事" 创建一个赛事</p>}
          </div>
        ) : (
          <div className="grid gap-4">
            {tournaments.map(t => (
              <Link key={t.id} to={`/tournament/${t.id}`}
                className="bg-white rounded-xl shadow hover:shadow-md transition-shadow p-6 flex items-center justify-between group">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">{t.name}</h3>
                  <p className="text-gray-500 text-sm mt-1">{t.description || '暂无简介'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColor[t.status] || 'bg-gray-100 text-gray-600'}`}>
                    {statusLabel[t.status] || t.status}
                  </span>
                  {user?.role === 'ADMIN' && (t.status === 'PENDING' || t.status === 'FINISHED') && (
                    <button onClick={(e) => handleDelete(e, t.id, t.name)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded text-sm"
                      title="删除赛事">
                      删除
                    </button>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
