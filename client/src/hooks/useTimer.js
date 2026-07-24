import { useState, useEffect, useRef } from 'react';

/**
 * useTimer — server-authoritative countdown from turnEndsAt.
 *
 * Computes `remaining = max(0, ceil((turnEndsAt - Date.now()) / 1000))`
 * locally using requestAnimationFrame for smooth UI.
 *
 * TIMER_TICK events arrive every ~10s for recalibration — the hook reads
 * the latest turnEndsAt from a ref so the rAF loop never needs to restart.
 * This avoids the stale-display bug where React re-triggers the effect
 * on every recalibration event, tearing down and recreating the loop.
 *
 * @param {{ turnEndsAt: number|null, timerStatus: string, durationSeconds: number }} timerMeta
 * @returns {{ remainingSeconds: number, progress: number, isPaused: boolean, formattedTime: string }}
 */
export function useTimer({ turnEndsAt, timerStatus, durationSeconds }) {
  const [remaining, setRemaining] = useState(0);
  const rafRef = useRef(null);
  const prevSecRef = useRef(-1);

  // Store latest values in refs so the rAF loop always reads current data
  // without needing to be restarted when they change
  const turnEndsAtRef = useRef(turnEndsAt);
  const timerStatusRef = useRef(timerStatus);

  // Sync refs on every render (these updates don't restart the loop)
  turnEndsAtRef.current = turnEndsAt;
  timerStatusRef.current = timerStatus;

  useEffect(() => {
    const tick = () => {
      const status = timerStatusRef.current;
      const endsAt = turnEndsAtRef.current;

      // If no timer or paused, freeze the display
      if (!endsAt || status === 'PAUSED' || status === 'FINISHED') {
        // One final update to show the frozen value
        if (endsAt && status !== 'FINISHED') {
          const secs = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
          if (secs !== prevSecRef.current) {
            prevSecRef.current = secs;
            setRemaining(secs);
          }
        }
        // Don't schedule another frame — loop stays idle until values change
        rafRef.current = null;
        return;
      }

      // Active timer — compute remaining from server timestamp
      const secs = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      if (secs !== prevSecRef.current) {
        prevSecRef.current = secs;
        setRemaining(secs);
      }

      if (secs > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    // Start the loop — it keeps running as long as the timer is active
    const startLoop = () => {
      if (rafRef.current) return; // already running
      rafRef.current = requestAnimationFrame(tick);
    };

    // Kick off the loop immediately
    startLoop();

    // Watcher: if the loop stops (paused/expired) and then values change,
    // we need to restart it. Use a short polling interval as a safety net.
    const watcher = setInterval(() => {
      const status = timerStatusRef.current;
      const endsAt = turnEndsAtRef.current;
      if (endsAt && status === 'RUNNING' && !rafRef.current) {
        prevSecRef.current = -1; // reset so first frame always updates
        startLoop();
      }
    }, 1000);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      clearInterval(watcher);
    };
  }, []); // Empty deps — loop runs once, reads from refs

  const progress = durationSeconds ? remaining / durationSeconds : 0;
  const isPaused = timerStatus === 'PAUSED';
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const formattedTime = `${minutes}:${String(seconds).padStart(2, '0')}`;

  return { remainingSeconds: remaining, progress, isPaused, formattedTime };
}
