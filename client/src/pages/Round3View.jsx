/**
 * Round3View — Round 3 (Collaborate) dedicated view.
 *
 * Three-panel layout:
 *   Left: team info, player indicators (online, focus, colored dot), puzzle progress
 *   Center: active puzzle with SudokuGrid in collaborationMode
 *   Right: collaboration log, suggestions queue with accept/reject
 */
import { useState, useEffect, useMemo } from 'react';
import SudokuGrid from '../components/SudokuGrid';
import { useLanguage } from '../i18n/LanguageContext';

const DIFFICULTY_STYLES = {
  EASY: { badge: 'bg-green-700/50 text-green-300', dot: 'bg-green-500' },
  MEDIUM: { badge: 'bg-yellow-700/50 text-yellow-300', dot: 'bg-yellow-500' },
  HARD: { badge: 'bg-red-700/50 text-red-300', dot: 'bg-red-500' },
};

const PLAYER_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-orange-500',
  'bg-cyan-500', 'bg-lime-500', 'bg-rose-500', 'bg-amber-500',
];

export default function Round3View({
  round3State,
  activePuzzle,
  currentRound,
  user,
  activeTeammates,
  onSelectPuzzle,
  onProposeCell,
  onAcceptProposal,
  onRejectProposal,
  onWithdrawProposal,
  onFullGridSubmit,
  onFocusUpdate,
}) {
  const { t } = useLanguage();
  const [collabLog, setCollabLog] = useState([]);

  const puzzles = round3State?.puzzles || [];
  const suggestions = round3State?.suggestions || {};
  const suggestionVotes = round3State?.suggestionVotes || {};
  const playerFocuses = round3State?.playerFocuses || {};
  const teamMembers = round3State?.teamMembers || [];
  const cells = round3State?.cells || {};
  const teamScore = round3State?.teamScore || 0;
  const solvedCount = round3State?.solvedCount || 0;
  const totalPuzzles = round3State?.totalPuzzles || 10;

  // Build collaboration log from suggestions and cells
  useEffect(() => {
    const entries = [];

    // Active suggestions
    Object.entries(suggestions).forEach(([key, sug]) => {
      entries.push({
        id: `suggest-${key}`,
        type: 'proposal',
        key,
        playerName: sug.playerName || `Player ${sug.playerId}`,
        playerId: sug.playerId,
        value: sug.value,
        row: key.split('-')[0],
        col: key.split('-')[1],
        timestamp: sug.timestamp || Date.now(),
      });
    });

    // Recently filled cells
    Object.entries(cells).forEach(([key, cell]) => {
      entries.push({
        id: `cell-${key}`,
        type: 'filled',
        key,
        playerName: cell.playerName || `Player ${cell.playerId}`,
        playerId: cell.playerId,
        value: cell.value,
        row: key.split('-')[0],
        col: key.split('-')[1],
        timestamp: cell.timestamp || Date.now(),
      });
    });

    // Sort by timestamp descending, keep last 20
    entries.sort((a, b) => b.timestamp - a.timestamp);
    setCollabLog(entries.slice(0, 20));
  }, [suggestions, cells]);

  // Player list — the FULL team roster (all members), with live online status.
  const playerList = useMemo(() => {
    const uid = user ? String(user.userId) : null;
    const isOnline = (pid) =>
      pid === uid ||
      !!(activeTeammates && activeTeammates[pid]);

    // Primary source: the full roster the server sends in round3State.teamMembers.
    if (teamMembers.length > 0) {
      return teamMembers.map(m => {
        const pid = String(m.playerId);
        return {
          id: pid,
          name: m.playerName || `Player ${pid}`,
          online: m.online || isOnline(pid),
          focus: playerFocuses[pid] || null,
        };
      });
    }

    // Fallback (roster not loaded yet): online teammates + current user.
    const players = new Map();
    if (activeTeammates) {
      Object.entries(activeTeammates).forEach(([pid, info]) => {
        players.set(String(pid), { id: String(pid), name: info.playerName || `Player ${pid}`, focus: playerFocuses[String(pid)] || null, online: true });
      });
    }
    if (user && !players.has(uid)) {
      players.set(uid, { id: uid, name: user.displayName || 'You', focus: null, online: true });
    }
    return [...players.values()];
  }, [teamMembers, activeTeammates, playerFocuses, user]);

  // Build currentGrid for the active puzzle by merging initialGrid + cells
  const mergedGrid = useMemo(() => {
    if (!activePuzzle?.initialGrid) return null;
    const grid = activePuzzle.initialGrid.map(row => [...row]);
    Object.entries(cells).forEach(([key, cell]) => {
      const [r, c] = key.split('-').map(Number);
      if (r >= 0 && r < 9 && c >= 0 && c < 9) {
        grid[r][c] = cell.value;
      }
    });
    return grid;
  }, [activePuzzle, cells]);

  // Report focus when active puzzle changes or cell is selected
  const handleCellClick = (row, col) => {
    onFocusUpdate?.(row, col);
  };

  return (
    <div className="flex gap-4">
      {/* Left Panel: Team Info + Puzzle Progress */}
      <div className="w-72 flex-shrink-0 space-y-4">
        {/* Round Info */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-indigo-300 mb-2">{t('round3.roundTitle')}</h3>
          <p className="text-xs text-gray-400 mb-3">{t('round3.roundDesc')}</p>
          <div className="flex items-center gap-3">
            <div className="bg-gray-700 rounded px-3 py-1.5">
              <span className="text-xs text-gray-400 block">{t('round3.teamScore')}</span>
              <span className="text-yellow-400 font-bold">{teamScore}</span>
            </div>
            <div className="bg-gray-700 rounded px-3 py-1.5">
              <span className="text-xs text-gray-400 block">{t('round3.solved')}</span>
              <span className="text-white font-bold">{solvedCount}<span className="text-gray-500 text-xs">/{totalPuzzles}</span></span>
            </div>
          </div>
        </div>

        {/* Team Players */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('round3.team')}</h3>
          <div className="space-y-2">
            {playerList.map((p, i) => {
              const isMe = String(p.id) === String(user?.userId);
              return (
                <div key={p.id} className={`flex items-center gap-2 px-2 py-1.5 rounded ${isMe ? 'bg-indigo-900/30' : 'bg-gray-700/50'} ${p.online ? '' : 'opacity-50'}`}>
                  <span className={`w-3 h-3 rounded-full ${p.online ? PLAYER_COLORS[i % PLAYER_COLORS.length] : 'bg-gray-500'}`} />
                  <span className={`text-sm flex-1 ${isMe ? 'text-white font-medium' : 'text-gray-300'}`}>
                    {p.name}
                    {isMe && <span className="text-[10px] text-indigo-300 ml-1">{t('round3.you')}</span>}
                  </span>
                  {p.focus ? (
                    <span className="text-[10px] text-gray-500">
                      R{p.focus.row + 1}C{p.focus.col + 1}
                    </span>
                  ) : !p.online ? (
                    <span className="text-[10px] text-gray-500">{t('round3.offline')}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Puzzle Progress */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('round3.puzzleList')}</h3>
          <div className="space-y-1.5">
            {puzzles.map((p, i) => {
              const isActive = activePuzzle?.puzzleId === p.puzzleId;
              const isSolved = p.isCompleted;
              const diffStyle = DIFFICULTY_STYLES[p.difficulty] || DIFFICULTY_STYLES.MEDIUM;

              return (
                <button
                  key={p.puzzleId}
                  onClick={() => onSelectPuzzle?.(p)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                    isActive ? 'bg-indigo-600 text-white' :
                    isSolved ? 'bg-green-900/40 text-green-300 hover:bg-green-900/60' :
                    'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {isSolved ? (
                    <span className="text-green-400 text-xs w-4">&#10003;</span>
                  ) : (
                    <span className="text-gray-500 text-xs w-4">{i + 1}</span>
                  )}
                  <span className="flex-1 truncate">P{i + 1}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${diffStyle.badge}`}>
                    {p.difficulty?.[0] || 'M'}
                  </span>
                  <span className="text-[10px] text-gray-500">{p.points}pt</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Center: Active Puzzle Grid with Collaboration Mode */}
      <div className="flex-1 min-w-0">
        {activePuzzle ? (
          <div>
            <div className="mb-3 flex items-center gap-3">
              <span className="text-gray-400 text-sm">
                {t('round3.puzzleN', { n: activePuzzle.orderInRound || puzzles.findIndex(p => p.puzzleId === activePuzzle.puzzleId) + 1 })}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                DIFFICULTY_STYLES[activePuzzle.difficulty]?.badge || DIFFICULTY_STYLES.MEDIUM.badge
              }`}>
                {activePuzzle.difficulty || 'MEDIUM'}
              </span>
              <span className="text-gray-500 text-xs">{t('round3.pointsShort', { n: activePuzzle.points })}</span>
              {activePuzzle.isCompleted && (
                <span className="bg-green-800/50 text-green-300 px-2 py-0.5 rounded text-xs">
                  {t('round3.completedBadge')} &#10003;
                </span>
              )}
            </div>
            <SudokuGrid
              initialGrid={activePuzzle.initialGrid}
              currentGrid={mergedGrid || activePuzzle.currentGrid || activePuzzle.initialGrid}
              roundType="ROUND3_COLLABORATE"
              difficulty={activePuzzle.difficulty}
              collaborationMode={true}
              suggestions={suggestions}
              playerFocuses={playerFocuses}
              onProposeCell={onProposeCell}
              onAcceptProposal={onAcceptProposal}
              onRejectProposal={onRejectProposal}
              onFullGridSubmit={onFullGridSubmit}
              currentUserId={user?.userId}
              onCellClick={handleCellClick}
            />
          </div>
        ) : (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">{t('round3.selectPuzzle')}</p>
          </div>
        )}
      </div>

      {/* Right Panel: Collaboration Log + Suggestions Queue */}
      <div className="w-72 flex-shrink-0 space-y-4">
        {/* Pending Suggestions — Accept/Reject */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('round3.pendingSuggestions')}</h3>
          {Object.keys(suggestions).length === 0 ? (
            <p className="text-xs text-gray-500">{t('round3.noPendingSuggestions')}</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(suggestions).map(([key, sug]) => {
                const isOwnSuggestion = String(sug.playerId) === String(user?.userId);
                const [r, c] = key.split('-');
                const votes = suggestionVotes[key] || [];
                const onlineTeammateCount = playerList.length - 1; // exclude proposer from count
                const requiredVotes = onlineTeammateCount; // all online teammates except proposer
                const hasVoted = votes.some(v => String(v) === String(user?.userId));

                return (
                  <div key={key} className="bg-gray-700/50 rounded px-3 py-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-yellow-400 text-sm font-medium">{sug.value}</span>
                        <span className="text-gray-400 text-xs ml-2">R{Number(r) + 1}C{Number(c) + 1}</span>
                      </div>
                      <span className="text-[10px] text-gray-500">{sug.playerName || `P${sug.playerId}`}</span>
                    </div>
                    {/* Vote progress */}
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 bg-gray-600 rounded-full h-1.5">
                        <div
                          className="bg-green-500 h-1.5 rounded-full transition-all"
                          style={{ width: `${requiredVotes > 0 ? (votes.length / requiredVotes) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-400">{votes.length}/{requiredVotes}</span>
                    </div>
                    {!isOwnSuggestion && !hasVoted && (
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={() => onAcceptProposal?.(Number(r), Number(c))}
                          className="flex-1 px-2 py-1 bg-green-700 hover:bg-green-600 text-white text-xs rounded font-medium transition-colors"
                        >
                          {t('round3.accept')}
                        </button>
                        <button
                          onClick={() => onRejectProposal?.(Number(r), Number(c))}
                          className="flex-1 px-2 py-1 bg-red-700 hover:bg-red-600 text-white text-xs rounded font-medium transition-colors"
                        >
                          {t('round3.reject')}
                        </button>
                      </div>
                    )}
                    {!isOwnSuggestion && hasVoted && (
                      <p className="text-[10px] text-green-400 mt-1">{t('round3.youAccepted')}</p>
                    )}
                    {isOwnSuggestion && (
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-[10px] text-gray-500 flex-1">{t('round3.waitingApproval')}</p>
                        <button
                          onClick={() => onWithdrawProposal?.(Number(r), Number(c))}
                          className="px-2 py-0.5 bg-gray-600 hover:bg-gray-500 text-gray-300 text-[10px] rounded transition-colors"
                        >
                          {t('round3.withdraw')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Collaboration Log */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('round3.activity')}</h3>
          {collabLog.length === 0 ? (
            <p className="text-xs text-gray-500">{t('round3.noActivity')}</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {collabLog.map((entry) => (
                <div key={entry.id} className={`text-xs px-2 py-1.5 rounded ${
                  entry.type === 'proposal' ? 'bg-yellow-900/20 text-yellow-300' : 'bg-green-900/20 text-green-300'
                }`}>
                  <span className="font-medium">{entry.playerName}</span>
                  {entry.type === 'proposal' ? (
                    <span> {t('round3.proposedText', { cell: `R${Number(entry.row) + 1}C${Number(entry.col) + 1}` })} <span className="font-bold">{entry.value}</span></span>
                  ) : (
                    <span> {t('round3.filledText', { cell: `R${Number(entry.row) + 1}C${Number(entry.col) + 1}` })} <span className="font-bold">{entry.value}</span></span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
