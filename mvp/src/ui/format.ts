import { useSyncExternalStore } from 'react';
import { engine } from '../core/engine';

export function useEngine() {
  useSyncExternalStore(engine.subscribe, engine.getVersion);
  return engine.state;
}

const IST = { timeZone: 'Asia/Kolkata', hour12: false } as const;

export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { ...IST, hour: '2-digit', minute: '2-digit' });
export const fmtClock = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { ...IST, hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** seconds → "4:12" */
export function fmtCountdown(s: number) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export const fmtKm = (m: number) => `${(m / 1000).toFixed(1)} km`;

export function fmtExpiry(expiresAt: number, now: number) {
  const h = (expiresAt - now) / 3600_000;
  if (h < 0) return 'expired';
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}
