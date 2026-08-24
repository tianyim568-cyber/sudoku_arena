/**
 * Round1View — Round 1 (Nine-One) dedicated view.
 *
 * Renders: clue board (left), active puzzle grid (center), puzzle list (right).
 */
import { useMemo } from 'react';
import SudokuGrid from '../components/SudokuGrid';
import { useLanguage } from '../i18n/LanguageContext';

export default function Round1View({
  puzzles,
  activePuzzle,
  round1Progress,
  teamScore,
  timerRemaining,
  onSelectPuzzle,
  onCellSubmit,
  onFullGridSubmit,
}) {
  const { t } = useLanguage();
  const jocPuzzles = useMemo(() => puzzles.filter(p => !p.isFinal), [puzzles]);
  const solvedCount = useMemo(() => puzzles.filter(p => p.isCompleted).length, [puzzles]);
  const jocSolvedCount = useMemo(() => jocPuzzles.filter(p => p.isCompleted).length, [jocPuzzles]);
  const isFinalUnlocked = round1Progress?.finalUnlocked || false;

  // Build clue slots from puzzle letters — each slot corresponds to a JOC puzzle
  const clueSlots = useMemo(() => {
    const slots = [];
    for (let i = 0; i < 9; i++) {
      const puzzle = jocPuzzles[i];
      const letter = puzzle?.letter || null;
      const isSolved = puzzle?.isCompleted || !!round1Progress?.solvedPuzzles?.[puzzle?.puzzleId];
      // A letter is "revealed" if the puzzle is solved OR if it appears in the clues list
      const isRevealed = isSolved || (letter && round1Progress?.clues?.includes(letter));
      slots.push({ index: i, letter, isRevealed, puzzle });
    }
    return slots;
  }, [jocPuzzles, round1Progress]);


  const effectiveRoundType = useMemo(() => {
    if (!activePuzzle) return 'ROUND1_NINE_ONE';
    if (activePuzzle.isFinal) return 'ROUND1_FINAL';
    return 'ROUND1_NINE_ONE';
  }, [activePuzzle]);

  return (
    <div className="flex flex-col lg:flex-row gap-4 sm:gap-6">
      {/* Left Panel: Clue Board + Score + Final Puzzle Status */}
      <div className="w-full lg:w-72 lg:flex-shrink-0 space-y-4 order-2 lg:order-1">
        {/* Clue Board */}
        <div className="bg-purple-900/30 border border-purple-700/30 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-purple-300 mb-3">{t('round1.clueBoard')}</h3>
          <div className="grid grid-cols-3 gap-2">
            {clueSlots.map((slot, i) => (
              <div key={i} className={`w-16 h-16 flex flex-col items-center justify-center rounded-lg font-bold text-lg transition-all ${
                slot.isRevealed ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30' :
                slot.letter ? 'bg-purple-800/40 text-purple-400' :
                'bg-gray-700 text-gray-500'
              }`}>
                {slot.isRevealed ? slot.letter : (slot.letter ? '?' : '-')}
                {slot.letter && !slot.isRevealed && (
                  <span className="text-[10px] text-purple-500 mt-0.5">P{i + 1}</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-purple-200/60 mt-2 text-center">
            {t('round1.cluesRevealed', { n: clueSlots.filter(s => s.isRevealed).length })}
          </p>
          {/* Revealed letters form a word hint */}
          {clueSlots.filter(s => s.isRevealed).length > 0 && (
            <div className="mt-2 pt-2 border-t border-purple-700/30">
              <p className="text-xs text-purple-300 text-center font-mono tracking-widest">
                {clueSlots.map(s => s.isRevealed ? s.letter : '_').join(' ')}
              </p>
            </div>
          )}
        </div>

        {/* Score Panel */}
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('round1.teamScore')}</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">{t('round1.solvedPuzzles')}</span>
              <span className="text-white font-medium">{solvedCount}/10</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">{t('round1.puzzleScore')}</span>
              <span className="text-white font-medium">{teamScore}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">{t('round1.timeBonus')}</span>
              <span className={solvedCount >= 10 ? 'text-green-400 font-medium' : 'text-gray-500'}>
                {solvedCount >= 10 ? `+${Math.floor((timerRemaining || 0) / 60) * 3} ${t('round1.pending')}` : '--'}
              </span>
            </div>
            <div className="border-t border-gray-700 pt-2 flex justify-between text-sm">
              <span className="text-gray-300 font-medium">{t('round1.currentTotal')}</span>
              <span className="text-yellow-400 font-bold text-lg">{teamScore}</span>
            </div>
          </div>
        </div>

        {/* Final Puzzle Status */}
        <div className={`rounded-lg p-4 ${
          isFinalUnlocked
            ? 'bg-green-900/30 border border-green-600/40'
            : 'bg-gray-800 border border-gray-700/50'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            {isFinalUnlocked ? (
              <span className="text-green-400 text-lg">&#10003;</span>
            ) : (
              <span className="text-gray-500 text-lg">&#128274;</span>
            )}
            <h3 className={`text-sm font-semibold ${isFinalUnlocked ? 'text-green-300' : 'text-gray-400'}`}>
              {t('round1.finalPuzzle')}
            </h3>
          </div>
          {isFinalUnlocked ? (
            <p className="text-xs text-green-200/70">{t('round1.finalUnlocked')}</p>
          ) : (
            <p className="text-xs text-gray-500">
              {t('round1.finalLockedHint', { n: jocSolvedCount })}
            </p>
          )}
        </div>
      </div>

      {/* Center: Active Puzzle Grid */}
      <div className="flex-1 min-w-0 order-1 lg:order-2">
        {activePuzzle ? (
          activePuzzle.isLocked ? (
            <div className="flex flex-col items-center justify-center py-12 sm:py-20">
              <span className="text-4xl sm:text-5xl mb-4">&#128274;</span>
              <p className="text-gray-400 text-base sm:text-lg font-medium">{t('round1.finalLockedTitle')}</p>
              <p className="text-gray-500 text-xs sm:text-sm mt-2">{t('round1.finalLockedSub')}</p>
              <p className="text-gray-600 text-xs sm:text-sm mt-1">{t('round1.finalLockedCount', { n: jocSolvedCount })}</p>
            </div>
          ) : (
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="text-gray-400 text-xs sm:text-sm">
                  {t('round1.puzzleN', { n: activePuzzle.orderInRound || puzzles.indexOf(activePuzzle) + 1 })}
                </span>
                {activePuzzle.letter && (
                  <span className="bg-purple-700/50 text-purple-300 px-2 py-0.5 rounded text-xs">
                    {t('round1.letterBadge', { letter: activePuzzle.letter })}
                  </span>
                )}
                {activePuzzle.isFinal && (
                  <span className="bg-green-700/50 text-green-300 px-2 py-0.5 rounded text-xs">
                    {t('round1.finalBadge')}
                  </span>
                )}
                {activePuzzle.isCompleted && (
                  <span className="bg-green-800/50 text-green-300 px-2 py-0.5 rounded text-xs">
                    {t('round1.completedBadge')} &#10003;
                  </span>
                )}
              </div>
              <SudokuGrid
                initialGrid={activePuzzle.initialGrid}
                currentGrid={activePuzzle.currentGrid || activePuzzle.initialGrid}
                roundType={effectiveRoundType}
                onCellSubmit={onCellSubmit}
                onFullGridSubmit={onFullGridSubmit}
              />
            </div>
          )
        ) : (
          <div className="text-center py-12 sm:py-20">
            <p className="text-gray-400 text-base sm:text-lg">{t('round1.selectPuzzle')}</p>
          </div>
        )}
      </div>

      {/* Right Panel: Puzzle List */}
      <div className="w-full lg:w-64 lg:flex-shrink-0 space-y-4 order-3">
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('round1.puzzleList')}</h3>
          <div className="space-y-1.5">
            {puzzles.map((p, i) => {
              const isActive = activePuzzle?.puzzleId === p.puzzleId;
              const isSolved = p.isCompleted || !!round1Progress?.solvedPuzzles?.[p.puzzleId];
              const isLocked = p.isLocked;

              return (
                <button
                  key={p.puzzleId}
                  onClick={() => !isLocked && onSelectPuzzle?.(p)}
                  disabled={isLocked}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                    isActive ? 'bg-indigo-600 text-white' :
                    isSolved ? 'bg-green-900/40 text-green-300 hover:bg-green-900/60' :
                    isLocked ? 'bg-gray-700/30 text-gray-600 cursor-not-allowed' :
                    'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {isSolved ? (
                    <span className="text-green-400 text-xs w-4">&#10003;</span>
                  ) : isLocked ? (
                    <span className="text-gray-600 text-xs w-4">&#128274;</span>
                  ) : (
                    <span className="text-gray-500 text-xs w-4">{i + 1}</span>
                  )}
                  <span className="flex-1 truncate">
                    {p.isFinal ? t('round1.finalShort') : `P${i + 1}`}
                  </span>
                  {p.letter && !isSolved && (
                    <span className="bg-purple-700/50 text-purple-300 px-1.5 py-0.5 rounded text-[10px]">
                      {p.letter}
                    </span>
                  )}
                  {isSolved && p.letter && (
                    <span className="bg-purple-600/50 text-purple-200 px-1.5 py-0.5 rounded text-[10px]">
                      {p.letter}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-500">{p.points}pt</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-yellow-900/30 border border-yellow-700/30 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-yellow-300 mb-1">{t('round1.roundTitle')}</h3>
          <p className="text-xs text-yellow-200/70">
            {t('round1.roundDesc')}
          </p>
        </div>
      </div>
    </div>
  );
}
