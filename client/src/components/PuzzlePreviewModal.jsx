/**
 * PuzzlePreviewModal — interactive preview of a puzzle with solution.
 *
 * Displays the initial grid and solution side by side, with option to
 * toggle solution visibility. Used from RoundBankImport to let admins
 * verify puzzles before importing them.
 */
import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';

export default function PuzzlePreviewModal({ puzzle, onClose }) {
  const { t } = useLanguage();
  const [showSolution, setShowSolution] = useState(false);

  if (!puzzle) return null;

  const { initialGrid, solution, difficulty, score, emptyCellCount } = puzzle;

  const renderGrid = (grid, highlightDiffs = false) => {
    if (!grid || grid.length !== 9) return null;
    return (
      <div className="grid grid-cols-9 gap-0 border-2 border-gray-800 w-fit">
        {grid.map((row, rowIdx) =>
          row.map((cell, colIdx) => {
            const isInitial = initialGrid[rowIdx][colIdx] !== 0;
            const borderRight = colIdx === 2 || colIdx === 5 ? 'border-r-2 border-r-gray-800' : 'border-r border-r-gray-400';
            const borderBottom = rowIdx === 2 || rowIdx === 5 ? 'border-b-2 border-b-gray-800' : 'border-b border-b-gray-400';
            const bgColor = highlightDiffs && !isInitial ? 'bg-yellow-100' : 'bg-white';
            const textColor = highlightDiffs && !isInitial ? 'text-blue-600 font-semibold' : 'text-gray-900';

            return (
              <div
                key={`${rowIdx}-${colIdx}`}
                className={`w-10 h-10 flex items-center justify-center text-sm ${bgColor} ${textColor} ${borderRight} ${borderBottom}`}
              >
                {cell !== 0 ? cell : ''}
              </div>
            );
          })
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900">
              {t('puzzlePreview.title')}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-3 text-sm">
            <div className="px-3 py-1 bg-gray-100 rounded">
              <span className="text-gray-600">{t('puzzlePreview.difficulty')}:</span>{' '}
              <span className="font-medium text-gray-900">{difficulty}</span>
            </div>
            <div className="px-3 py-1 bg-gray-100 rounded">
              <span className="text-gray-600">{t('puzzlePreview.score')}:</span>{' '}
              <span className="font-medium text-gray-900">{score}</span>
            </div>
            <div className="px-3 py-1 bg-gray-100 rounded">
              <span className="text-gray-600">{t('puzzlePreview.emptyCells')}:</span>{' '}
              <span className="font-medium text-gray-900">{emptyCellCount}</span>
            </div>
          </div>

          <div className="mb-4">
            <button
              onClick={() => setShowSolution(!showSolution)}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500 text-sm font-medium"
            >
              {showSolution ? t('puzzlePreview.hideSolution') : t('puzzlePreview.showSolution')}
            </button>
          </div>

          <div className="flex flex-col lg:flex-row gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">{t('puzzlePreview.initialGrid')}</h3>
              {renderGrid(initialGrid, showSolution)}
            </div>

            {showSolution && solution && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">{t('puzzlePreview.solution')}</h3>
                {renderGrid(solution, true)}
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 text-sm font-medium"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
