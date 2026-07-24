import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../api';

export default function JudgeControlPage() {
  const { tournamentId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState(null);
  const [roomStatus, setRoomStatus] = useState(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    const res = await api.getTournament(tournamentId);
    if (res.code === 200) setTournament(res.data);
  };

  const loadRoomStatus = async () => {
    const res = await api.getRoomStatus(tournamentId);
    if (res.code === 200) setRoomStatus(res.data);
  };

  useEffect(() => { load(); }, [tournamentId]);
  useEffect(() => {
    if (tournament?.status === 'IN_PROGRESS' || tournament?.status === 'PAUSED') {
      loadRoomStatus();
      const iv = setInterval(loadRoomStatus, 5000);
      return () => clearInterval(iv);
    }
  }, [tournament?.status]);

  const handleAction = async (action, ...args) => {
    try {
      let res;
      switch (action) {
        case 'start': res = await api.startTournament(tournamentId); break;
        case 'pause': res = await api.pauseTournament(tournamentId); break;
        case 'resume': res = await api.resumeTournament(tournamentId); break;
        case 'end': res = await api.endTournament(tournamentId); break;
        case 'startRound': res = await api.startRound(tournamentId, args[0]); break;
        case 'endRound': res = await api.endRound(tournamentId, args[0]); break;
      }
      if (res.code === 200) {
        setMessage(`操作：${action} - 成功`);
        load();
        loadRoomStatus();
      } else {
        setMessage(`错误：${res.message}`);
      }
    } catch (e) {
      setMessage(`错误：${e.message}`);
    }
  };

  const formatTime = (seconds) => {
    if (seconds == null) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!tournament) return <div className="flex items-center justify-center h-screen">加载中...</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gray-800 text-white px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate(`/tournament/${tournamentId}`)} className="text-gray-400 hover:text-white">&larr; 返回</button>
            <div>
              <h1 className="text-lg font-bold">{tournament.name}</h1>
              <span className="text-sm text-gray-400">裁判控制台</span>
            </div>
          </div>
          <span className={`px-3 py-1 rounded text-sm font-medium ${
            tournament.status === 'PENDING' ? 'bg-yellow-600' :
            tournament.status === 'IN_PROGRESS' ? 'bg-green-600' :
            tournament.status === 'PAUSED' ? 'bg-orange-600' : 'bg-gray-600'
          }`}>{tournament.status === 'PENDING' ? '未开始' : tournament.status === 'IN_PROGRESS' ? '进行中' : tournament.status === 'PAUSED' ? '已暂停' : '已结束'}</span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        {message && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-blue-700 text-sm">{message}</div>
        )}

        {/* Tournament Controls */}
        <section className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">赛事控制</h2>
          <div className="flex flex-wrap gap-3">
            {tournament.status === 'PENDING' && (
              <button onClick={() => handleAction('start')}
                className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors">
                开始赛事
              </button>
            )}
            {tournament.status === 'IN_PROGRESS' && (
              <>
                <button onClick={() => handleAction('pause')}
                  className="px-6 py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-medium transition-colors">
                  暂停
                </button>
                <button onClick={() => handleAction('end')}
                  className="px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors">
                  结束赛事
                </button>
              </>
            )}
            {tournament.status === 'PAUSED' && (
              <button onClick={() => handleAction('resume')}
                className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors">
                恢复
              </button>
            )}
          </div>
        </section>

        {/* Round Controls */}
        <section className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">轮次控制</h2>
          <div className="space-y-3">
            {tournament.rounds?.map((r, i) => (
              <div key={r.id} className="border rounded-lg p-4 flex items-center justify-between">
                <div>
                  <h3 className="font-medium">第 {r.round_number} 轮：{r.name}</h3>
                  <p className="text-sm text-gray-500">{r.round_type} | {r.duration_seconds}秒 | 题目：{r.puzzles?.length || 0}道</p>
                  {r.remaining_seconds != null && r.status === 'IN_PROGRESS' && (
                    <p className="text-lg font-mono mt-1 text-blue-600">{formatTime(r.remaining_seconds)}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    r.status === 'NOT_STARTED' ? 'bg-gray-100 text-gray-600' :
                    r.status === 'IN_PROGRESS' ? 'bg-green-100 text-green-700' :
                    r.status === 'PAUSED' ? 'bg-orange-100 text-orange-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>{r.status === 'NOT_STARTED' ? '未开始' : r.status === 'IN_PROGRESS' ? '进行中' : r.status === 'PAUSED' ? '已暂停' : '已结束'}</span>
                  {tournament.status === 'IN_PROGRESS' && r.status === 'NOT_STARTED' && (
                    <button onClick={() => handleAction('startRound', r.id)}
                      className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded text-sm">
                      开始轮次
                    </button>
                  )}
                  {r.status === 'IN_PROGRESS' && (
                    <button onClick={() => handleAction('endRound', r.id)}
                      className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-sm">
                      结束轮次
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Room Status */}
        {roomStatus && (
          <section className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">房间状态</h2>
            {roomStatus.currentRound && (
              <p className="text-sm text-gray-600 mb-4">
                当前轮次：<span className="font-medium">{roomStatus.currentRound.name}</span>
                {' '}(剩余：{formatTime(roomStatus.currentRound.remaining_seconds)})
              </p>
            )}
            <div className="grid grid-cols-2 gap-4">
              {roomStatus.teams?.map(team => (
                <div key={team.id} className="border rounded-lg p-4">
                  <h3 className="font-medium text-gray-800">{team.name}</h3>
                  <div className="mt-2 space-y-1">
                    {team.members?.map(m => (
                      <div key={m.id} className="flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-gray-600">{m.display_name || m.username}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Scores */}
        <section className="bg-white rounded-xl shadow p-6">
          <h2 className="text-lg font-semibold mb-4">队伍得分</h2>
          <button onClick={async () => {
            const res = await api.getTeamScores(tournamentId);
            if (res.code === 200) setRoomStatus(prev => ({ ...prev, scores: res.data }));
          }} className="px-4 py-2 bg-indigo-600 text-white rounded text-sm mb-4">
            刷新得分
          </button>
          {roomStatus?.scores && roomStatus.scores.length > 0 ? (
            <div className="space-y-2">
              {roomStatus.scores.map(s => (
                <div key={s.id} className="flex items-center justify-between border-b pb-2">
                  <span className="font-medium">{s.team_name}</span>
                  <span className="text-lg font-bold text-indigo-600">{s.total_points} 分</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-sm">暂无得分。选手在轮次中提交正确答案后会出现得分。</p>
          )}
        </section>
      </main>
    </div>
  );
}
