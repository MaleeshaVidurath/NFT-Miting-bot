import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';

/**
 * Plain-text log written next to the program.
 *
 * The packaged build has no console window, so this file is the only record
 * that survives after the app closes - the dashboard's Activity tab is lost
 * the moment the process ends.
 *
 * Deliberately free of other imports: it must still work when configuration
 * itself failed to load, which is exactly when someone needs the log most.
 */
const PATH = process.env.LOG_FILE ?? 'hunter.log';
const MAX_BYTES = Number(process.env.LOG_FILE_MAX_BYTES ?? 5_000_000);

let broken = false;

function rotateIfBig(): void {
  try {
    if (!existsSync(PATH)) return;
    if (statSync(PATH).size < MAX_BYTES) return;
    const previous = PATH + '.1';
    if (existsSync(previous)) unlinkSync(previous);
    renameSync(PATH, previous);
  } catch {
    /* keep logging to the current file rather than failing */
  }
}

export function writeLogLine(line: string): void {
  if (broken) return;
  try {
    rotateIfBig();
    appendFileSync(PATH, line + '\n', 'utf8');
  } catch {
    // Read-only folder or a locked file. Give up quietly - logging must never
    // take the program down with it.
    broken = true;
  }
}

export function logFilePath(): string {
  return PATH;
}
