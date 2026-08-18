/**
 * DisplayPage — full-screen big-screen display, public route /display/:token.
 *
 * No auth required — the display token in the URL is the access key.
 *
 * Role of this page: fetch the ranking snapshot on a fixed interval, and
 * decide WHICH view to render. Today only the ranking view exists; the plan
 * calls for three more (current round, final podium, etc.) but the server
 * events and view names they depend on are not specced yet. When they land,
 * they will be added as another branch of the view switch below — no
 * rewrite of this page.
 *
 * Polling vs realtime: the server emits a RANKING_UPDATE event, but to a
 * WebSocket room that requires a JWT — this public page authenticates with a
 * token, not a JWT, so it cannot join the room. The missing piece is in ws/,
 * on Sylvain's side. Until then, we poll every 10 s. Do not bolt on a
 * client-side realtime workaround — it would not work and would mask the
 * real gap.
 *
 * Category filtering is a query parameter on the GET, so switching tab
 * triggers an immediate refetch rather than waiting for the next poll tick.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import RankingView from '../components/RankingView';
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
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const snapshot = await fetchRanking(token, selectedCategoryId);
      if (!snapshot) {
        setError('无效的显示令牌或数据加载失败');
        return;
      }
      setData(snapshot);
      setLastUpdated(new Date());
      setError('');
    } catch (e) {
      setError('网络连接失败，正在重试...');
    }
  }, [token, selectedCategoryId]);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, [load]);

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

  // View switch. Only the ranking view exists today; other views (current
  // round, podium, etc.) will be added here as separate components when their
  // server contracts are specced. The structure is in place so they plug in
  // without touching the fetch/poll logic above.
  //
  // LOCAL BOUNDARY: RankingView renders a lot of layout from a server
  // snapshot — a malformed payload could crash it. If it crashes, the
  // polling loop above keeps running (it's in a separate useEffect, not
  // inside the boundary), so the next tick may recover. The big screen
  // shows a targeted message instead of going black — which matters on a
  // public display in front of a room.
  return (
    <LocalErrorBoundary>
      <RankingView
        data={data}
        selectedCategoryId={selectedCategoryId}
        onSelectCategory={setSelectedCategoryId}
        lastUpdated={lastUpdated}
        pollIntervalSeconds={POLL_INTERVAL_MS / 1000}
      />
    </LocalErrorBoundary>
  );
}
