import { spawnSync } from 'node:child_process';
import { logFilePath, writeLogLine } from './logfile.js';

/**
 * Tells the user something when there is no console to print to.
 *
 * The packaged executable runs without a console window, so a startup failure
 * would otherwise be completely silent - the program would appear to do
 * nothing at all. This writes the reason to a file and raises a dialog.
 */
export function alertUser(title: string, message: string): void {
  writeLogLine(new Date().toISOString() + ' [ERROR] ' + title + ': ' + message);

  if (process.platform !== 'win32') {
    console.error(title + ': ' + message);
    return;
  }

  // Quoting for PowerShell: single quotes are literal, doubled to escape.
  const esc = (s: string) => s.replace(/'/g, "''");
  const body = message + '\n\nSee ' + logFilePath() + ' next to the program.';
  const script =
    'Add-Type -AssemblyName PresentationFramework;' +
    "[System.Windows.MessageBox]::Show('" + esc(body) + "','" + esc(title) + "') | Out-Null";

  try {
    spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      timeout: 30000,
      windowsHide: true,
    });
  } catch {
    /* nothing more we can do */
  }
}
