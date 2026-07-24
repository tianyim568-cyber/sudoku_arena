/**
 * Round1View — Round 1 (Nine-One) dedicated view.
 *
 * Renders: clue board (left), active puzzle grid (center), puzzle list (right).
 */
import { useMemo } from 'react';
import SudokuGrid from '../components/SudokuGrid';

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
  const jocPuzzles = useMemo(() => puzzles.filter(p => !p.isFinal), [puzzles]);
  const finalPuzzle = useMemo(() => puzzles.find(p => p.isFinal), [puzzles]);
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

  const clues = useMemo(() => {
    if (!round1Progress?.clues?.length) return [];
    if (typeof round1Progress.clues[0] === 'object') {
      return round1Progress.clues.sort((a, b) => a.orderInRound - b.orderInRound).map(c => c.letter);
    }
    return round1Progress.clues;
  }, [round1Progress]);

  const effectiveRoundType = useMemo(() => {
    if (!activePuzzle) return 'ROUND1_NINE_ONE';
    if (activePuzzle.isFinal) return 'ROUND1_FINAL';
    return 'ROUND1_NINE_ONE';
  }, [activePuzzle]);

  return (
    <div className="flex gap-6">
      {/* Left Panel: Clue Board + Score + Final Puzzle Status */}
      <div className="w-72 flex-shrink-0 space-y-4">
        {/* Clue Board */}
        <div className="bg-purple-900/30 border border-purple-700/30 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-purple-300 mb-3">线索板</h3>
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
            {clueSlots.filter(s => s.isRevealed).length}/9 线索已揭示
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
          <h3 className="text-sm font-semibold text-gray-300 mb-3">队伍得分</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">已解题目</span>
              <span className="text-white font-medium">{solvedCount}/10</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">题目得分</span>
              <span className="text-white font-medium">{teamScore}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">时间奖励</span>
              <span className={solvedCount >= 10 ? 'text-green-400 font-medium' : 'text-gray-500'}>
                {solvedCount >= 10 ? `+${Math.floor((timerRemaining || 0) / 60) * 3} 待结算` : '--'}
              </span>
            </div>
            <div className="border-t border-gray-700 pt-2 flex justify-between text-sm">
              <span className="text-gray-300 font-medium">当前总分</span>
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
              终极题目
            </h3>
          </div>
          {isFinalUnlocked ? (
            <p className="text-xs text-green-200/70">已解锁！解答终极棋盘可获得额外奖励。</p>
          ) : (
            <p className="text-xs text-gray-500">
              解答全部9道JOC题目即可解锁。({jocSolvedCount}/9)
            </p>
          )}
        </div>
      </div>

      {/* Center: Active Puzzle Grid */}
      <div className="flex-1 min-w-0">
        {activePuzzle ? (
          activePuzzle.isLocked ? (
            <div className="flex flex-col items-center justify-center py-20">
              <span className="text-5xl mb-4">&#128274;</span>
              <p className="text-gray-400 text-lg font-medium">终极题目已锁定</p>
              <p className="text-gray-500 text-sm mt-2">解答全部9道JOC题目即可解锁</p>
              <p className="text-gray-600 text-sm mt-1">{jocSolvedCount}/9 已完成</p>
            </div>
          ) : (
            <div>
              <div className="mb-3 flex items-center gap-3">
                <span className="text-gray-400 text-sm">
                  题目 {activePuzzle.orderInRound || puzzles.indexOf(activePuzzle) + 1}
                </span>
                {activePuzzle.letter && (
                  <span className="bg-purple-700/50 text-purple-300 px-2 py-0.5 rounded text-xs">
                    字母：{activePuzzle.letter}
                  </span>
                )}
                {activePuzzle.isFinal && (
                  <span className="bg-green-700/50 text-green-300 px-2 py-0.5 rounded text-xs">
                    终极题目
                  </span>
                )}
                {activePuzzle.isCompleted && (
                  <span className="bg-green-800/50 text-green-300 px-2 py-0.5 rounded text-xs">
                    已完成 &#10003;
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
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">选择一道题目开始</p>
          </div>
        )}
      </div>

      {/* Right Panel: Puzzle List */}
      <div className="w-64 flex-shrink-0 space-y-4">
        <div className="bg-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">题目列表</h3>
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
                    {p.isFinal ? '终极' : `P${i + 1}`}
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
          <h3 className="text-sm font-semibold text-yellow-300 mb-1">第一轮：九宫一填</h3>
          <p className="text-xs text-yellow-200/70">
            找出每道JOC题目中唯一的空格并提交其数值。
            每次正确答案会揭示一个字母线索。解答全部9道即可解锁终极题目！
          </p>
        </div>
      </div>
    </div>
  );
}
