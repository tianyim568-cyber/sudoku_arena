/**
 * DisplayPage — full-screen big-screen display, public route /display/:token.
 *
 * No auth required — the display token in the URL is the access key.
 *
 * Role of this page: keep a snapshot fresh, and decide WHICH view to render.
 * It owns the data and the transport; the views own their layout.
 *
 * Transport: the server emits to a display room that a token-bearing client
 * can join, so updates arrive over the socket — RANKING_UPDATE,
 * DISPLAY_MODE_CHANGED, DISPLAY_PLAYER_BROADCAST, DISPLAY_TOKEN_REVOKED.
 * HTTP polling stays as a fallback and runs only while the socket is down: a
 * screen in front of a room must not go stale because a connection dropped.
 *
 * Views: PLAYER_BROADCAST spotlights one player; ROUND_RANKING shows the
 * ranking of a single round (the live one, else the most recent finished
 * one); every other mode shows the full ranking grid. Further views (stage
 * podium, final podium) plug in as branches here without touching the
 * transport above.
 *
 * Category filtering is a query parameter on the GET, so switching tab
 * triggers an immediate refetch rather than waiting for the next tick.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  connectDisplaySocket,
  disconnectDisplaySocket,
  onDisplayEvent,
} from '../api/socket';
import RankingView from '../components/RankingView';
import BroadcastView from '../components/BroadcastView';
import RoundRankingView from '../components/RoundRankingView';
import DisplayFinalRankingView from '../components/DisplayFinalRankingView';
import { LocalErrorBoundary } from '../components/ErrorBoundary';

const API_BASE = '/api';
const POLL_INTERVAL_MS = 10000;

async function fetchRanking(token, categoryId) {
  const params = categoryId ? `?categoryId=${categoryId}` : '';
  const res = await fetch(`${API_BASE}/display/${token}/ranking${params}`);
  if (!res.ok) return null;
  const json = await res.json();
  return json.code === 200 ? json.data : null;
}

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
  // The socket handler is registered once (its effect depends only on the
  // token), so it closes over the render values of that moment. Anything it
  // needs to READ at call time lives in a ref — a plain state read would see
  // the initial value forever.
  const dataRef = useRef(null);
  dataRef.current = data;

  // Applying a snapshot is the same work whether it arrived by socket or by
  // poll, so it lives in one place.
  const applySnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    setData(snapshot);
    setDisplayMode(snapshot.competition.displayMode || 'DEFAULT');
    if (snapshot.broadcastPlayer) {
      setBroadcastPlayer(snapshot.broadcastPlayer);
    } else if (snapshot.competition.displayMode !== 'PLAYER_BROADCAST') {
      setBroadcastPlayer(null);
    }
    setLastUpdated(new Date());
    setError('');
  }, []);

  const load = useCallback(async () => {
    try {
      const snapshot = await fetchRanking(token, selectedCategoryId);
      if (!snapshot) {
        setError('无效的显示令牌或数据加载失败');
        return;
      }
      applySnapshot(snapshot);
    } catch {
      setError('网络连接失败，正在重试...');
    }
  }, [token, selectedCategoryId, applySnapshot]);

  // Realtime channel.
  useEffect(() => {
    const socket = connectDisplaySocket(token);
    if (!socket) return;

    const handleConnect = () => setSocketConnected(true);
    const handleDisconnect = () => setSocketConnected(false);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    setSocketConnected(socket.connected);

    const unsubscribe = onDisplayEvent((event) => {
      if (event.type === 'RANKING_UPDATE') {
        applySnapshot(event.data.snapshot);
      } else if (event.type === 'DISPLAY_MODE_CHANGED') {
        const mode = event.data.mode;
        if (!mode) return;
        setDisplayMode(mode);
        if (dataRef.current) {
          setData({
            ...dataRef.current,
            competition: { ...dataRef.current.competition, displayMode: mode },
          });
        }
        if (mode !== 'PLAYER_BROADCAST') setBroadcastPlayer(null);
      } else if (event.type === 'DISPLAY_PLAYER_BROADCAST') {
        const player = event.data.player;
        if (!player) return;
        setBroadcastPlayer(player);
        setDisplayMode('PLAYER_BROADCAST');
        if (dataRef.current) {
          setData({
            ...dataRef.current,
            competition: { ...dataRef.current.competition, displayMode: 'PLAYER_BROADCAST' },
          });
        }
      } else if (event.type === 'DISPLAY_TOKEN_REVOKED') {
        // The judge revoked this screen. Say so plainly and stop reconnecting:
        // silently showing a frozen ranking would be worse than an explicit
        // message on a wall in front of a room.
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
  }, [token, applySnapshot]);

  // Fallback channel. Always fetch once on mount — the first paint must not
  // wait for a socket handshake — then poll only while the socket is down.
  useEffect(() => {
    load();

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

  const showBroadcast = displayMode === 'PLAYER_BROADCAST' && broadcastPlayer;

  // View selection. The server knows six display modes; four have client
  // views today:
  //   - PLAYER_BROADCAST → BroadcastView (spotlights one player)
  //   - ROUND_RANKING    → RoundRankingView (ranking of one round, large)
  //   - FINAL_RANKING    → DisplayFinalRankingView (final podium, large)
  //   - everything else  → RankingView (the full ranking grid)
  // The remaining modes (STAGE_RANKING) has no view yet — it falls through
  // to RankingView rather than showing a blank screen. Adding a view means
  // adding a branch here; the transport above does not change.
  const renderView = () => {
    if (showBroadcast) {
      return <BroadcastView player={broadcastPlayer} lastUpdated={lastUpdated} />;
    }
    if (displayMode === 'ROUND_RANKING') {
      return (
        <RoundRankingView
          data={data}
          lastUpdated={lastUpdated}
          pollIntervalSeconds={POLL_INTERVAL_MS / 1000}
          socketConnected={socketConnected}
        />
      );
    }
    if (displayMode === 'FINAL_RANKING') {
      return (
        <DisplayFinalRankingView
          data={data}
          lastUpdated={lastUpdated}
          pollIntervalSeconds={POLL_INTERVAL_MS / 1000}
          socketConnected={socketConnected}
        />
      );
    }
    return (
      <RankingView
        data={data}
        selectedCategoryId={selectedCategoryId}
        onSelectCategory={setSelectedCategoryId}
        lastUpdated={lastUpdated}
        pollIntervalSeconds={POLL_INTERVAL_MS / 1000}
        socketConnected={socketConnected}
      />
    );
  };

  // LOCAL BOUNDARY: both views render a lot of layout from a server snapshot,
  // and a malformed payload could crash one. The transport effects above sit
  // OUTSIDE the boundary, so they keep running — the next update may recover
  // on its own. Meanwhile the screen shows a message instead of going black,
  // which matters on a public display in front of a room.
  return (
    <LocalErrorBoundary>
      {renderView()}
    </LocalErrorBoundary>
  );
}
