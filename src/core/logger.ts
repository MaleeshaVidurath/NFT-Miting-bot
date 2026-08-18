import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

function emit(level: Level, msg: string, extra?: unknown) {
  if (LEVELS[level] < LEVELS[config.logLevel]) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${msg}`;
  if (extra === undefined) console.log(line);
  else console.log(line, extra);
}

export const log = {
  debug: (m: string, e?: unknown) => emit('debug', m, e),
  info: (m: string, e?: unknown) => emit('info', m, e),
  warn: (m: string, e?: unknown) => emit('warn', m, e),
  error: (m: string, e?: unknown) => emit('error', m, e),
};
