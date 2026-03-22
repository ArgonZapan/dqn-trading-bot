import { useState, useEffect, useRef } from 'react';

export function useTrainingTimer(active) {
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (active) {
      // Start or resume
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now() - elapsed * 1000;
      }
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      // Stop — keep elapsed time
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      startTimeRef.current = null;
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active]);

  // Reset timer when training stops (optional — keeps last time)
  const reset = () => {
    setElapsed(0);
    startTimeRef.current = null;
  };

  const format = () => {
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  return { elapsed, format, reset };
}
