/**
 * PuzzleBoard — Round 2 puzzle status grid.
 *
 * Renders a 4x4 grid showing the status of all team puzzles.
 * Click a puzzle to view it (if it's the player's assigned puzzle).
 */
import { useLanguage } from '../i18n/LanguageContext';

export default function PuzzleBoard({ puzzles, solvedCount, totalPuzzles, assignedPuzzleId, onSelectPuzzle }) {
  const { t } = useLanguage();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
      {puzzles.map((p, idx) => {
        const isAssigned = p.puzzleId === assignedPuzzleId;
        const difficultyColor = p.difficulty === 'EASY' ? '#4caf50' : p.difficulty === 'HARD' ? '#f44336' : '#ff9800';

        return (
          <div
            key={p.puzzleId}
            onClick={() => onSelectPuzzle?.(p)}
            style={{
              padding: '8px',
              borderRadius: '6px',
              border: isAssigned ? '2px solid #2196f3' : '1px solid #ddd',
              backgroundColor: p.isCompleted ? '#e8f5e9' : '#fff',
              cursor: isAssigned ? 'pointer' : 'default',
              textAlign: 'center',
              opacity: p.isCompleted ? 0.7 : 1,
              position: 'relative'
            }}
          >
            <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#333' }}>
              #{p.orderInRound || idx + 1}
            </div>
            <div style={{ fontSize: '10px', color: difficultyColor, fontWeight: 'bold' }}>
              {p.difficulty || 'MED'}
            </div>
            <div style={{ fontSize: '10px', color: '#666' }}>
              {t('round2.points', { n: p.points })}
            </div>
            {p.isCompleted && (
              <div style={{ fontSize: '16px', position: 'absolute', top: '2px', right: '4px' }}>&#10003;</div>
            )}
          </div>
        );
      })}
      <div style={{ gridColumn: '1 / -1', textAlign: 'center', fontSize: '13px', color: '#666', marginTop: '4px' }}>
        {t('round2.solvedProgress', { n: solvedCount, total: totalPuzzles })}
      </div>
    </div>
  );
}
