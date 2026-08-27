/**
 * IndividualRoundView — Solo speed-solving view for individual rounds.
 *
 * Layout: puzzle list (left), active puzzle grid (center), progress stats (right).
 * Simpler than Round1View: no clue board, no team mechanics, just pure solo solving.
 */
import { useMemo } from 'react';
import SudokuGrid from '../components/SudokuGrid';
import { useLanguage } from '../i18n/LanguageContext';

export default function IndividualRoundView({
  puzzles,
  activePuzzle,
  onSelectPuzzle,
  onCellSubmit,
  onFullGridSubmit,
  roundType,
}) {
  const { t } = useLanguage();
  const solvedCount = useMemo(() => puzzles.filter(p => p.isCompleted).length, [puzzles]);
  const totalPuzzles = puzzles.length;
  const progressPercent = totalPuzzles > 0 ? Math.round((solvedCount / totalPuzzles) * 100) : 0;

  return (
    <div className="flex flex-col lg:flex-row gap-4 sm:gap-6">
      {/* Left Panel: Puzzle List */}
      <div className="w-full lg:w-64 lg:flex-shrink-0 space-y-4 order-2 lg:order-1">
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('individual.puzzleList')}</h3>
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {puzzles.map((p, i) => {
              const isActive = activePuzzle?.puzzleId === p.puzzleId;
              const isSolved = p.isCompleted;

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
                  <span className="flex-1 truncate">
                    {t('individual.puzzleN', { n: i + 1 })}
                  </span>
                  <span className="text-[10px] text-gray-500">{p.points}pt</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-blue-900/30 border border-blue-700/30 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-blue-300 mb-1">{t('individual.roundTitle')}</h3>
          <p className="text-xs text-blue-200/70">
            {t('individual.roundDesc')}
          </p>
        </div>
      </div>

      {/* Center: Active Puzzle Grid */}
      <div className="flex-1 min-w-0 order-1 lg:order-2">
        {activePuzzle ? (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2 sm:gap-3">
              <span className="text-gray-400 text-xs sm:text-sm">
                {t('individual.puzzleN', { n: activePuzzle.orderInRound || puzzles.findIndex(p => p.puzzleId === activePuzzle.puzzleId) + 1 })}
              </span>
              {activePuzzle.isCompleted && (
                <span className="bg-green-800/50 text-green-300 px-2 py-0.5 rounded text-xs">
                  {t('individual.completedBadge')} &#10003;
                </span>
              )}
              <span className="bg-blue-800/50 text-blue-300 px-2 py-0.5 rounded text-xs">
                {activePuzzle.difficulty || 'MEDIUM'}
              </span>
            </div>
            <SudokuGrid
              initialGrid={activePuzzle.initialGrid}
              currentGrid={activePuzzle.currentGrid || activePuzzle.initialGrid}
              roundType={roundType}
              onCellSubmit={onCellSubmit}
              onFullGridSubmit={onFullGridSubmit}
            />
          </div>
        ) : (
          <div className="text-center py-12 sm:py-20">
            <p className="text-gray-400 text-base sm:text-lg">{t('individual.selectPuzzle')}</p>
          </div>
        )}
      </div>

      {/* Right Panel: Progress Stats */}
      <div className="w-full lg:w-72 lg:flex-shrink-0 space-y-4 order-3">
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('individual.progress')}</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">{t('individual.solvedPuzzles')}</span>
              <span className="text-white font-medium">{solvedCount}/{totalPuzzles}</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">{t('individual.completionRate')}</span>
              <span className="text-white font-medium">{progressPercent}%</span>
            </div>
          </div>
        </div>

        <div className="bg-yellow-900/30 border border-yellow-700/30 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-yellow-300 mb-1">{t('individual.tipsTitle')}</h3>
          <p className="text-xs text-yellow-200/70">
            {t('individual.tipsDesc')}
          </p>
        </div>
      </div>
    </div>
  );
}
