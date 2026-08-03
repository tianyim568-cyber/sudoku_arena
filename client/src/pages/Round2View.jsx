/**
 * Round2View — Round 2 (Rotating Relay) dedicated view.
 *
 * Renders: status bar with rotation warning (left), puzzle board grid,
 * active assigned puzzle (center).
 */
import { useMemo, useState, useEffect, useRef } from 'react';
import SudokuGrid from '../components/SudokuGrid';
import { useLanguage } from '../i18n/LanguageContext';

export default function Round2View({
  round2State,
  activePuzzle,
  user,
  onCellChange,
  onFullGridSubmit,
  rotationWarning,
}) {
  const { t } = useLanguage();
  // Countdown within the 5-second warning window
  const [warningSeconds, setWarningSeconds] = useState(5);
  const countdownRef = useRef(null);

  useEffect(() => {
    if (rotationWarning) {
      setWarningSeconds(5);
      countdownRef.current = setInterval(() => {
        setWarningSeconds(prev => {
          if (prev <= 1) {
            clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setWarningSeconds(5);
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    }
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    };
  }, [rotationWarning]);
  const r2ActivePuzzle = useMemo(() => {
    // Use assignedPuzzle from round2State as the primary source
    if (round2State.assignedPuzzle) {
      return round2State.assignedPuzzle;
    }
    // Fallback to activePuzzle (set by REST or socket)
    return activePuzzle;
  }, [round2State.assignedPuzzle, activePuzzle]);

  return (
    <div className="space-y-4">
      {/* Rotation Warning Banner — fixed top-center with countdown */}
      {rotationWarning && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[90%] sm:w-auto max-w-lg">
          <div className="bg-red-600 text-white px-4 sm:px-8 py-3 sm:py-4 rounded-xl shadow-2xl shadow-red-600/40 font-bold text-base sm:text-xl flex items-center gap-2 sm:gap-3 justify-center">
            <svg className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm sm:text-xl">{t('round2.rotationCountdown', { n: warningSeconds })}</span>
            <span className="ml-2 bg-red-800 rounded-full w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center text-xl sm:text-2xl tabular-nums">{warningSeconds}</span>
          </div>
        </div>
      )}

      {/* Status Bar: Team Score + Solved Count */}
      <div className="bg-gray-800 border border-gray-700/50 rounded-lg p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <span className="text-base sm:text-lg font-semibold text-indigo-300">{t('round2.roundTitle')}</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Team Score */}
            <div className="bg-gray-700 rounded-lg px-3 sm:px-4 py-2">
              <span className="text-xs text-gray-400 block">{t('round2.teamScore')}</span>
              <span className="text-yellow-400 font-bold text-base sm:text-lg">{round2State.teamScore}<span className="text-gray-500 text-xs sm:text-sm">/200</span></span>
            </div>
            <div className="bg-gray-700 rounded-lg px-3 sm:px-4 py-2">
              <span className="text-xs text-gray-400 block">{t('round2.solved')}</span>
              <span className="text-white font-bold text-base sm:text-lg">{round2State.solvedCount}<span className="text-gray-500 text-xs sm:text-sm">/{round2State.totalPuzzles}</span></span>
            </div>
          </div>
        </div>
        {/* Player order indicator */}
        <div className="flex items-center gap-2 mt-3 overflow-x-auto pb-1">
          {round2State.playerOrder.map((pid, i) => {
            const isMe = pid === user?.userId;
            return (
              <div key={pid} className={`flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap ${
                isMe ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-400'
              }`}>
                <span className={`w-2 h-2 rounded-full ${isMe ? 'bg-green-400' : 'bg-gray-500'}`} />
                {round2State.playerNames[pid] || `P${i + 1}`}
                {isMe && <span className="text-[10px]">{t('round2.you')}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 sm:gap-6">
        {/* Left: Puzzle Board (4x4 grid showing status of all 16 puzzles) */}
        <div className="w-full lg:w-80 lg:flex-shrink-0 order-2 lg:order-1">
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('round2.puzzleBoard')}</h3>
            <div className="grid grid-cols-4 gap-2">
              {round2State.puzzles.map((p, i) => {
                const isCurrentPuzzle = r2ActivePuzzle?.puzzleId === p.puzzleId;
                const difficultyColors = {
                  EASY: 'border-green-600/40',
                  MEDIUM: 'border-yellow-600/40',
                  HARD: 'border-red-600/40'
                };
                const difficultyBg = {
                  EASY: 'bg-green-600/20 text-green-400',
                  MEDIUM: 'bg-yellow-600/20 text-yellow-400',
                  HARD: 'bg-red-600/20 text-red-400'
                };

                return (
                  <div
                    key={p.puzzleId}
                    className={`relative w-full aspect-square rounded-lg border-2 flex flex-col items-center justify-center text-xs ${
                      p.isCompleted ? 'bg-green-900/30 border-green-600/40 text-green-300' :
                      isCurrentPuzzle ? 'bg-indigo-900/40 border-indigo-500 text-indigo-200 ring-2 ring-indigo-500/50' :
                      `${difficultyColors[p.difficulty] || 'border-gray-600/40'} bg-gray-800/50 text-gray-200`
                    }`}
                  >
                    {/* Difficulty badge */}
                    <span className={`absolute top-0.5 right-0.5 px-1 rounded text-[8px] font-bold ${difficultyBg[p.difficulty] || 'bg-gray-600/20 text-gray-400'}`}>
                      {p.difficulty?.[0] || '?'}
                    </span>
                    {/* Puzzle number */}
                    <span className="font-bold text-sm">{i + 1}</span>
                    {/* Points */}
                    <span className="text-[10px] text-gray-500">{t('round2.points', { n: p.points })}</span>
                    {/* Status indicator */}
                    {p.isCompleted && <span className="text-green-400 text-sm mt-0.5">&#10003;</span>}
                    {isCurrentPuzzle && !p.isCompleted && <span className="text-indigo-400 text-[10px]">&#9654;</span>}
                  </div>
                );
              })}
            </div>
            {/* Legend */}
            <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-600/40"></span>{t('common.difficulty.EASY')}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-yellow-600/40"></span>{t('common.difficulty.MEDIUM')}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-600/40"></span>{t('common.difficulty.HARD')}</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-indigo-500"></span>{t('round2.current')}</span>
            </div>
          </div>

          {/* Completion bonus indicator */}
          {round2State.allSolved && round2State.completionBonus > 0 && (
            <div className="mt-3 bg-yellow-900/30 border border-yellow-600/40 rounded-lg p-3 text-center">
              <span className="text-yellow-400 font-bold">{t('round2.allSolved')}</span>
              <p className="text-yellow-300 text-sm mt-1">{t('round2.completionBonus', { bonus: round2State.completionBonus })}</p>
            </div>
          )}
        </div>

        {/* Center: Active Puzzle */}
        <div className="flex-1 min-w-0 order-1 lg:order-2">
          {r2ActivePuzzle ? (
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="text-gray-400 text-xs sm:text-sm">
                  {t('round2.yourPuzzle')}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  r2ActivePuzzle.difficulty === 'EASY' ? 'bg-green-700/50 text-green-300' :
                  r2ActivePuzzle.difficulty === 'MEDIUM' ? 'bg-yellow-700/50 text-yellow-300' :
                  r2ActivePuzzle.difficulty === 'HARD' ? 'bg-red-700/50 text-red-300' :
                  'bg-gray-700/50 text-gray-300'
                }`}>
                  {r2ActivePuzzle.difficulty || 'STANDARD'}
                </span>
                <span className="text-gray-500 text-xs">{t('round2.pointsShort', { n: r2ActivePuzzle.points })}</span>
              </div>
              <SudokuGrid
                initialGrid={r2ActivePuzzle.initialGrid}
                currentGrid={r2ActivePuzzle.currentGrid || r2ActivePuzzle.initialGrid}
                roundType="ROUND2_RELAY"
                difficulty={r2ActivePuzzle.difficulty}
                onCellChange={onCellChange}
                onFullGridSubmit={onFullGridSubmit}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 sm:py-20">
              <span className="text-4xl sm:text-5xl mb-4 text-gray-600">&#128209;</span>
              <p className="text-gray-400 text-base sm:text-lg font-medium">
                {t('round2.waitingAssign')}
              </p>
              <p className="text-gray-500 text-xs sm:text-sm mt-2">{t('round2.waitingAssignSub')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
