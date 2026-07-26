import { useState, useCallback, useEffect } from 'react';
import { useLanguage } from '../i18n/LanguageContext';

export default function SudokuGrid({
  initialGrid, currentGrid, roundType,
  onCellSubmit, onFullGridSubmit, onCellChange, readOnly, difficulty,
  // Collaboration mode props (R3)
  collaborationMode, suggestions, playerFocuses,
  onProposeCell, onAcceptProposal, onRejectProposal, currentUserId
}) {
  const { t } = useLanguage();
  const [grid, setGrid] = useState(() => (currentGrid || initialGrid || []).map(row => [...row]));
  const [selectedCell, setSelectedCell] = useState(null); // {row, col}

  // Sync grid when currentGrid prop changes (from socket updates)
  useEffect(() => {
    if (currentGrid && currentGrid.length > 0) {
      setGrid(currentGrid.map(row => [...row]));
    }
  }, [currentGrid]);

  const handleCellClick = (row, col) => {
    if (readOnly) return;
    if (!initialGrid) return;
    // Don't allow selecting pre-filled cells
    if (initialGrid[row]?.[col] !== 0) return;
    setSelectedCell({ row, col });

    // In collaboration mode, report focus
    if (collaborationMode && onProposeCell) {
      // Focus is reported by the parent component
    }
  };

  const handleNumberInput = useCallback((num) => {
    if (readOnly) return;
    if (!selectedCell) return;
    const { row, col } = selectedCell;
    if (initialGrid[row]?.[col] !== 0) return;

    const newGrid = grid.map(r => [...r]);
    newGrid[row][col] = num;
    setGrid(newGrid);

    // For Round 1 JOC puzzles (single cell), auto-submit on number input
    if (roundType === 'ROUND1_NINE_ONE') {
      onCellSubmit?.(row, col, num);
    }
    // For Round 2: emit cell update in real-time
    if (roundType === 'ROUND2_RELAY' && onCellChange) {
      onCellChange(row, col, num);
    }
    // For Round 3 collaboration: propose instead of direct fill
    if (collaborationMode && onProposeCell) {
      onProposeCell(row, col, num);
    }
  }, [selectedCell, grid, initialGrid, roundType, onCellSubmit, onCellChange, onProposeCell, collaborationMode, readOnly]);

  const handleSubmitFullGrid = () => {
    onFullGridSubmit?.(grid);
  };

  const handleClear = () => {
    if (readOnly) return;
    if (!selectedCell) return;
    const { row, col } = selectedCell;
    if (initialGrid[row]?.[col] !== 0) return;
    const newGrid = grid.map(r => [...r]);
    newGrid[row][col] = 0;
    setGrid(newGrid);

    // For Round 2: emit cell clear
    if (roundType === 'ROUND2_RELAY' && onCellChange) {
      onCellChange(row, col, 0);
    }
  };

  if (!grid || grid.length === 0) {
    return <div className="text-gray-400">{t('grid.notLoaded')}</div>;
  }

  const difficultyColors = {
    EASY: 'bg-green-600 text-green-100',
    MEDIUM: 'bg-yellow-600 text-yellow-100',
    HARD: 'bg-red-600 text-red-100'
  };

  // Player color palette for focus indicators
  const playerColors = [
    'bg-blue-500', 'bg-purple-500', 'bg-pink-500', 'bg-orange-500',
    'bg-cyan-500', 'bg-lime-500', 'bg-rose-500', 'bg-amber-500'
  ];

  return (
    <div>
      {/* Difficulty badge */}
      {difficulty && (
        <div className="mb-2">
          <span className={`px-2 py-1 rounded text-xs font-bold ${difficultyColors[difficulty] || 'bg-gray-600 text-gray-100'}`}>
            {difficulty}
          </span>
        </div>
      )}

      {/* Grid */}
      <div className="inline-block border-2 border-gray-600 bg-gray-700">
        {grid.map((row, ri) => (
          <div key={ri} className="flex">
            {row.map((cell, ci) => {
              const isInitial = initialGrid?.[ri]?.[ci] !== 0;
              const isSelected = selectedCell?.row === ri && selectedCell?.col === ci;
              const boxBorder = (ri % 3 === 2 && ri < 8 ? 'border-b-2 border-b-gray-400' : '') +
                (ci % 3 === 2 && ci < 8 ? ' border-r-2 border-r-gray-400' : '');

              // Collaboration mode extras
              const cellKey = `${ri}-${ci}`;
              const suggestion = collaborationMode ? suggestions?.[cellKey] : null;
              const isOfficiallyFilled = collaborationMode && !isInitial && cell !== 0;
              const focusPlayers = collaborationMode
                ? Object.entries(playerFocuses || {})
                    .filter(([, f]) => f.row === ri && f.col === ci && Number(f.playerId || f[0]) !== currentUserId)
                : [];

              return (
                <div
                  key={ci}
                  onClick={() => handleCellClick(ri, ci)}
                  className={`relative w-12 h-12 flex items-center justify-center text-lg font-medium border border-gray-600 transition-colors ${boxBorder} ${
                    readOnly ? 'cursor-default' : 'cursor-pointer'
                  } ${
                    isInitial ? 'bg-gray-800 text-white cursor-default' :
                    isOfficiallyFilled && collaborationMode ? 'bg-green-900/40 text-green-300' :
                    isSelected ? 'bg-indigo-600 text-white' :
                    suggestion ? 'bg-yellow-900/20 text-yellow-300' :
                    'bg-gray-700 text-gray-200 hover:bg-gray-600'
                  }`}
                >
                  {cell !== 0 ? cell : ''}

                  {/* Suggestion indicator — yellow dashed outline + proposed value */}
                  {suggestion && cell === 0 && (
                    <span className="absolute inset-0 flex items-center justify-center border-2 border-dashed border-yellow-500/60 pointer-events-none">
                      <span className="text-yellow-400 text-xs font-bold opacity-70">{suggestion.value}</span>
                    </span>
                  )}

                  {/* Accept/reject buttons for suggestions from other players */}
                  {suggestion && suggestion.playerId !== currentUserId && cell === 0 && (
                    <div className="absolute -top-1 -right-1 flex gap-0.5 z-10">
                      <button
                        onClick={(e) => { e.stopPropagation(); onAcceptProposal?.(ri, ci); }}
                        className="w-4 h-4 bg-green-600 text-white text-[8px] rounded-full leading-none hover:bg-green-500"
                      >
                        &#10003;
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onRejectProposal?.(ri, ci); }}
                        className="w-4 h-4 bg-red-600 text-white text-[8px] rounded-full leading-none hover:bg-red-500"
                      >
                        &#10007;
                      </button>
                    </div>
                  )}

                  {/* Player focus indicators — colored dots */}
                  {focusPlayers.length > 0 && (
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                      {focusPlayers.slice(0, 3).map(([pid], i) => (
                        <span
                          key={pid}
                          className={`w-2 h-2 rounded-full ${playerColors[i % playerColors.length]}`}
                          title={focusPlayers[i]?.playerName || `Player ${pid}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Number Pad */}
      {!readOnly && (
        <div className="mt-4">
          {roundType === 'ROUND1_NINE_ONE' ? (
            // Round 1 JOC: auto-submit on tap, no clear/submit buttons
            <div className="flex gap-2">
              {Array.from({ length: 9 }, (_, i) => i + 1).map(num => (
                <button
                  key={num}
                  onClick={() => handleNumberInput(num)}
                  className="w-14 h-14 bg-indigo-700 hover:bg-indigo-600 text-white rounded-lg font-bold text-xl transition-colors"
                >
                  {num}
                </button>
              ))}
            </div>
          ) : (
            // Round 1 FINAL / Round 2 / Round 3: fill + submit full grid
            <div>
              <div className="flex gap-2 mb-3">
                {Array.from({ length: 9 }, (_, i) => i + 1).map(num => (
                  <button
                    key={num}
                    onClick={() => handleNumberInput(num)}
                    className="w-12 h-12 bg-gray-700 hover:bg-indigo-600 text-white rounded-lg font-bold text-lg transition-colors"
                  >
                    {num}
                  </button>
                ))}
                <button
                  onClick={handleClear}
                  className="w-12 h-12 bg-red-800 hover:bg-red-700 text-white rounded-lg font-bold text-sm transition-colors"
                >
                  X
                </button>
              </div>
              <button
                onClick={handleSubmitFullGrid}
                className="mt-3 px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors"
              >
                {t('grid.submitFullGrid')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Collaboration legend */}
      {collaborationMode && (
        <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 border-2 border-dashed border-yellow-500/60 rounded-sm"></span>
            {t('grid.suggestion')}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 bg-green-900/40 rounded-sm"></span>
            {t('grid.confirmedFilled')}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            {t('grid.playerFocus')}
          </span>
        </div>
      )}
    </div>
  );
}
