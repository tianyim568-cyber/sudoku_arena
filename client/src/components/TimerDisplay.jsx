/**
 * TimerDisplay — server-authoritative timer bar.
 *
 * Renders a visual progress bar that changes color as time runs out,
 * plus a formatted time string. Shows PAUSED indicator when paused.
 */
import { useLanguage } from '../i18n/LanguageContext';

export default function TimerDisplay({ remainingSeconds, totalSeconds, formattedTime, isPaused }) {
  const { t } = useLanguage();
  const percent = totalSeconds ? (remainingSeconds / totalSeconds) * 100 : 0;
  const color = percent > 50 ? '#4caf50' : percent > 20 ? '#ff9800' : '#f44336';

  return (
    <div className="relative w-full h-6 sm:h-8 bg-gray-200 rounded overflow-hidden">
      <div
        className="absolute top-0 left-0 h-full transition-all duration-1000"
        style={{ width: `${percent}%`, backgroundColor: color }}
      />
      <span className="relative z-10 flex items-center justify-center h-full font-bold text-xs sm:text-sm"
        style={{ color: percent > 50 ? '#fff' : '#333' }}>
        {formattedTime}{isPaused ? t('timer.paused') : ''}
      </span>
    </div>
  );
}
