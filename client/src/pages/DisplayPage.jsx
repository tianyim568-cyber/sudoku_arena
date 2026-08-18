/**
 * DisplayPage — full-screen big-screen ranking display.
 *
 * Public route: /display/:token
 * No auth required — uses the display token from the URL for access control.
 * Receives real-time ranking updates via WebSocket when connected,
 * falls back to HTTP polling every 10 seconds when the socket is down.
 * Supports category filtering via tabs.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  connectDisplaySocket,
  disconnectDisplaySocket,
  onDisplayEvent,
  isDisplaySocketConnected,
} from '../api/socket';

const API_BASE = '/api';
const POLL_INTERVAL_MS = 10000;

async function fetchRanking(token, categoryId) {
  const params = categoryId ? `?categoryId=${categoryId}` : '';
  const res = await fetch(`${API_BASE}/display/${token}/ranking${params}`);
  if (!res.ok) return null;
  const json = await res.json();
  return json.code === 200 ? json.data : null;
}

const STATUS_BADGE = {
  PENDING: { label: '等待中', color: 'bg-gray-500' },
  NOT_STARTED: { label: '未开始', color: 'bg-gray-500' },
  IN_PROGRESS: { label: '进行中', color: 'bg-green-500' },
  PAUSED: { label: '已暂停', color: 'bg-yellow-500' },
  FINISHED: { label: '已结束', color: 'bg-red-500' },
};

const STAGE_STATUS_BADGE = {
  PENDING: { label: '待开始', color: 'text-gray-400' },
  IN_PROGRESS: { label: '进行中', color: 'text-green-400' },
  FINISHED: { label: '已结束', color: 'text-blue-400' },
};

export default function DisplayPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [broadcastPlayer, setBroadcastPlayer] = useState(null);
  const [displayMode, setDisplayMode] = useState('DEFAULT');
  const timerRef = useRef(null);
  const dataRef = useRef(null);
  dataRef.current = data;

  const load = useCallback(async () => {
    try {
      const snapshot = await fetchRanking(token, selectedCategoryId);
      if (!snapshot) {
        setError('无效的显示令牌或数据加载失败');
        return;
      }
      setData(snapshot);
      setDisplayMode(snapshot.competition.displayMode || 'DEFAULT');
      if (snapshot.broadcastPlayer) {
        setBroadcastPlayer(snapshot.broadcastPlayer);
      } else if (snapshot.competition.displayMode !== 'PLAYER_BROADCAST') {
        setBroadcastPlayer(null);
      }
      setLastUpdated(new Date());
      setError('');
    } catch (e) {
      setError('网络连接失败，正在重试...');
    }
  }, [token, selectedCategoryId]);

  // WebSocket connection + event handlers
  useEffect(() => {
    const socket = connectDisplaySocket(token);
    if (!socket) return;

    // Track connection status
    const handleConnect = () => setSocketConnected(true);
    const handleDisconnect = () => setSocketConnected(false);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    setSocketConnected(socket.connected);

    // Listen for real-time events
    const unsubscribe = onDisplayEvent((event) => {
      if (event.type === 'RANKING_UPDATE') {
        const snapshot = event.data.snapshot;
        if (snapshot) {
          setData(snapshot);
          setDisplayMode(snapshot.competition.displayMode || 'DEFAULT');
          if (snapshot.broadcastPlayer) {
            setBroadcastPlayer(snapshot.broadcastPlayer);
          } else if (snapshot.competition.displayMode !== 'PLAYER_BROADCAST') {
            setBroadcastPlayer(null);
          }
          setLastUpdated(new Date());
          setError('');
        }
      } else if (event.type === 'DISPLAY_MODE_CHANGED') {
        const mode = event.data.mode;
        if (mode) {
          setDisplayMode(mode);
          if (dataRef.current) {
            setData({ ...dataRef.current, competition: { ...dataRef.current.competition, displayMode: mode } });
          }
          if (mode !== 'PLAYER_BROADCAST') {
            setBroadcastPlayer(null);
          }
        }
      } else if (event.type === 'DISPLAY_PLAYER_BROADCAST') {
        const player = event.data.player;
        if (player) {
          setBroadcastPlayer(player);
          setDisplayMode('PLAYER_BROADCAST');
          if (dataRef.current) {
            setData({ ...dataRef.current, competition: { ...dataRef.current.competition, displayMode: 'PLAYER_BROADCAST' } });
          }
        }
      } else if (event.type === 'DISPLAY_TOKEN_REVOKED') {
        setError('显示令牌已被撤销');
        disconnectDisplaySocket();
      }
    });

    return () => {
      unsubscribe();
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      disconnectDisplaySocket();
    };
  }, [token]);

  // HTTP polling fallback when WebSocket is disconnected
  useEffect(() => {
    // Always fetch once on mount
    load();

    // Only start polling if socket is not connected
    if (!socketConnected) {
      timerRef.current = setInterval(load, POLL_INTERVAL_MS);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [load, socketConnected]);

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 text-2xl mb-4">{error}</div>
          <div className="text-gray-500 text-sm">请检查显示令牌是否正确</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-xl">加载中...</div>
      </div>
    );
  }

  const { competition, categories, stages, finalRankings } = data;
  const statusBadge = STATUS_BADGE[competition.status] || STATUS_BADGE.PENDING;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-slate-900 to-gray-800 text-white">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{competition.name}</h1>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold text-white ${statusBadge.color}`}>
              {statusBadge.label}
            </span>
          </div>
          <div className="flex items-center gap-4">
            {lastUpdated && (
              <span className="text-gray-400 text-xs">
                更新于 {lastUpdated.toLocaleTimeString('zh-CN')}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Broadcast Player Card */}
      {displayMode === 'PLAYER_BROADCAST' && broadcastPlayer && (
        <div className="px-6 pt-6 max-w-7xl mx-auto">
          <div className="bg-gradient-to-r from-blue-900/50 to-purple-900/50 border border-blue-500/30 rounded-lg p-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <div className="w-20 h-2 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-3xl font-bold">
                  {broadcastPlayer.name.charAt(0)}
                </div>
                <div>
                  <div className="text-3xl font-bold mb-2">{broadcastPlayer.name}</div>
                  <div className="flex items-center gap-4 text-gray-300">
                    {broadcastPlayer.school && (
                      <span className="text-sm">{broadcastPlayer.school}</span>
                    )}
                    {broadcastPlayer.age && (
                      <span className="text-sm">{broadcastPlayer.age}岁</span>
                    )}
                    {broadcastPlayer.category && (
                      <span className="px-3 py-1 bg-blue-500/20 border border-blue-500/30 rounded text-xs">
                        {broadcastPlayer.category.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-blue-400">
                <div className="w-3 h-3 bg-blue-400 rounded-full animate-pulse"></div>
                <span className="text-sm font-medium">LIVE</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Category Tabs */}
      {categories && categories.length > 0 && (
        <nav className="px-6 pt-4 max-w-7xl mx-auto">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedCategoryId(null)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedCategoryId === null
                  ? 'bg-purple-600 text-white'
                  : 'bg-white/10 text-gray-300 hover:bg-white/20'
              }`}
            >
              全部组别
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategoryId(cat.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedCategoryId === cat.id
                    ? 'bg-purple-600 text-white'
                    : 'bg-white/10 text-gray-300 hover:bg-white/20'
                }`}
              >
                {cat.name}
                {cat.min_age != null && cat.max_age != null && (
                  <span className="ml-1 text-xs opacity-70">
                    ({cat.min_age}-{cat.max_age}岁)
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Stages & Rankings */}
      <main className="px-6 py-6 max-w-7xl mx-auto">
        {stages.length === 0 && (
          <div className="text-center text-gray-500 py-20">
            <div className="text-5xl mb-4">📋</div>
            <div className="text-lg">暂无比赛阶段数据</div>
          </div>
        )}

        <div className="space-y-8">
          {stages.map(stage => (
            <section key={stage.id}>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xl font-semibold">
                  阶段 {stage.orderNumber}
                  <span className="ml-2 text-gray-400 font-normal text-base">
                    ({stage.type})
                  </span>
                </h2>
                {STAGE_STATUS_BADGE[stage.status] && (
                  <span className={`text-xs font-medium ${STAGE_STATUS_BADGE[stage.status].color}`}>
                    {STAGE_STATUS_BADGE[stage.status].label}
                  </span>
                )}
              </div>

              {stage.rounds.length === 0 && (
                <div className="text-gray-500 text-sm pl-4">暂无轮次数据</div>
              )}

              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {stage.rounds.map(round => (
                  <div
                    key={round.id}
                    className="bg-white/5 border border-white/10 rounded-xl overflow-hidden"
                  >
                    <div className="px-4 py-3 border-b border-white/10 bg-white/5 flex items-center justify-between">
                      <h3 className="font-semibold text-sm">{round.name}</h3>
                      {STAGE_STATUS_BADGE[round.status] && (
                        <span className={`text-xs ${STAGE_STATUS_BADGE[round.status].color}`}>
                          {STAGE_STATUS_BADGE[round.status].label}
                        </span>
                      )}
                    </div>

                    {round.rankings.length === 0 ? (
                      <div className="px-4 py-6 text-center text-gray-500 text-sm">暂无排名数据</div>
                    ) : (
                      <div className="divide-y divide-white/5">
                        {round.rankings.slice(0, 20).map((r, idx) => (
                          <div
                            key={`${r.player.id}-${idx}`}
                            className="flex items-center px-4 py-2.5 hover:bg-white/5 transition-colors"
                          >
                            {/* Rank */}
                            <div className="w-10 flex-shrink-0">
                              {r.rank <= 3 ? (
                                <span
                                  className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                                    r.rank === 1
                                      ? 'bg-yellow-500 text-gray-900'
                                      : r.rank === 2
                                      ? 'bg-gray-300 text-gray-900'
                                      : 'bg-amber-700 text-white'
                                  }`}
                                >
                                  {r.rank}
                                </span>
                              ) : (
                                <span className="text-gray-400 text-sm pl-2">{r.rank}</span>
                              )}
                            </div>

                            {/* Player info */}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{r.player.name}</div>
                              <div className="text-xs text-gray-400 truncate">
                                {r.player.school && <span>{r.player.school}</span>}
                                {r.player.age != null && <span className="ml-2">{r.player.age}岁</span>}
                                {r.player.category && (
                                  <span className="ml-2 text-purple-400">{r.player.category.name}</span>
                                )}
                              </div>
                            </div>

                            {/* Score */}
                            <div className="flex-shrink-0 ml-3">
                              <span className="text-lg font-bold tabular-nums">
                                {r.totalScore}
                              </span>
                              <span className="text-xs text-gray-500 ml-1">分</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Final Rankings */}
        {finalRankings && finalRankings.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold mb-4">最终排名</h2>
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
              <div className="divide-y divide-white/5">
                {finalRankings.map((fr, idx) => (
                  <div key={`${fr.entityId}-${idx}`} className="flex items-center px-6 py-3">
                    <div className="w-12 flex-shrink-0">
                      {fr.rank <= 3 ? (
                        <span
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${
                            fr.rank === 1
                              ? 'bg-yellow-500 text-gray-900'
                              : fr.rank === 2
                              ? 'bg-gray-300 text-gray-900'
                              : 'bg-amber-700 text-white'
                          }`}
                        >
                          {fr.rank}
                        </span>
                      ) : (
                        <span className="text-gray-400 pl-2">{fr.rank}</span>
                      )}
                    </div>
                    <div className="flex-1">
                      <span className="text-sm font-medium">{fr.entityType}</span>
                      <span className="text-xs text-gray-400 ml-2">{fr.entityId?.slice(0, 8)}...</span>
                    </div>
                    <div className="text-lg font-bold tabular-nums">{fr.score}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-8 px-6 py-3 text-center text-gray-600 text-xs">
        数独竞技场 — 大屏排名显示 · {socketConnected ? '实时连接' : `每 ${POLL_INTERVAL_MS / 1000} 秒自动刷新`}
      </footer>
    </div>
  );
}
