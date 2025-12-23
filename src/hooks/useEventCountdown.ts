import { useState, useEffect } from 'react';

interface CountdownResult {
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
  isWithin12Hours: boolean;
  isStarted: boolean;
  displayString: string;
}

export function useEventCountdown(eventStart: Date): CountdownResult {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const totalMs = eventStart.getTime() - now.getTime();
  const isStarted = totalMs <= 0;
  const twelveHoursMs = 12 * 60 * 60 * 1000;
  const isWithin12Hours = totalMs > 0 && totalMs <= twelveHoursMs;

  if (isStarted) {
    return {
      hours: 0,
      minutes: 0,
      seconds: 0,
      totalMs: 0,
      isWithin12Hours: false,
      isStarted: true,
      displayString: '',
    };
  }

  const hours = Math.floor(totalMs / (1000 * 60 * 60));
  const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((totalMs % (1000 * 60)) / 1000);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return {
    hours,
    minutes,
    seconds,
    totalMs,
    isWithin12Hours,
    isStarted,
    displayString: parts.join(' '),
  };
}
