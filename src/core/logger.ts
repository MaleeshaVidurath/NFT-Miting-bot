import { config } from './config.js';
import { bus } from './events.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

/** Recent lines, so a dashboard opened later still shows context. */
const HISTORY_LIMIT = 500;
const history: { at: string; level: string; msg: string }[] = [];

function emit(level: Level, msg: string, extra?: unknown) {
  if (LEVELS[level] < LEVELS[config.logLevel]) return;

  const at = new Date().toISOString();
  const line = `${at} [${level.toUpperCase()}] ${msg}`;
  if (extra === undefined) console.log(line);
  else console.log(line, extra);

  const text = extra === undefined ? msg : msg + ' ' + safe(extra);
  const entry = { at, level, msg: text };
  history.push(entry);
  if (history.length > HISTORY_LIMIT) history.shift();
  bus.emitTyped('log', entry);
}

function safe(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
  } catch {
    return String(v);
  }
}

export function recentLogs(): { at: string; level: string; msg: string }[] {
  return [...history];
}

export const log = {
  debug: (m: string, e?: unknown) => emit('debug', m, e),
  info: (m: string, e?: unknown) => emit('info', m, e),
  warn: (m: string, e?: unknown) => emit('warn', m, e),
  error: (m: string, e?: unknown) => emit('error', m, e),
};
