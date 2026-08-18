/**
 * Liveness tracking for the scanners.
 *
 * "Running" only means the hunter was started. If a detector's polling loop
 * ever stopped rescheduling itself, the dashboard would still say Running
 * while nothing was actually being watched - the worst kind of failure for a
 * bot left alone overnight. Each sweep records a heartbeat so that silence
 * becomes visible.
 */
const beats = new Map<string, number>();

export function beat(detector: string): void {
  beats.set(detector, Date.now());
}

export function forget(detector: string): void {
  beats.delete(detector);
}

export function clearBeats(): void {
  beats.clear();
}

export interface Heartbeat {
  detector: string;
  secondsAgo: number;
}

export function heartbeats(): Heartbeat[] {
  const now = Date.now();
  return [...beats.entries()].map(([detector, at]) => ({
    detector,
    secondsAgo: Math.round((now - at) / 1000),
  }));
}

/** Detectors that have not reported within `staleMs`. */
export function stale(staleMs: number): Heartbeat[] {
  return heartbeats().filter((h) => h.secondsAgo * 1000 > staleMs);
}
