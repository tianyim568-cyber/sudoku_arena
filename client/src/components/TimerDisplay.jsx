/**
 * TimerDisplay — server-authoritative timer bar.
 *
 * Renders a visual progress bar that changes color as time runs out,
 * plus a formatted time string. Shows PAUSED indicator when paused.
 */
export default function TimerDisplay({ remainingSeconds, totalSeconds, formattedTime, isPaused }) {
  const percent = totalSeconds ? (remainingSeconds / totalSeconds) * 100 : 0;
  const color = percent > 50 ? '#4caf50' : percent > 20 ? '#ff9800' : '#f44336';

  return (
    <div className="timer-display" style={{ position: 'relative', width: '100%', height: '32px', backgroundColor: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
      <div
        className="timer-bar"
        style={{
          position: 'absolute', top: 0, left: 0, height: '100%',
          width: `${percent}%`, backgroundColor: color,
          transition: 'width 1s linear, background-color 0.5s'
        }}
      />
      <span
        className="timer-text"
        style={{
          position: 'relative', zIndex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100%', fontWeight: 'bold', fontSize: '14px',
          color: percent > 50 ? '#fff' : '#333'
        }}
      >
        {formattedTime}{isPaused ? ' (已暂停)' : ''}
      </span>
    </div>
  );
}
