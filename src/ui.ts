/**
 * Dashboard entry point.
 *
 * The packaged build runs with no console window, so anything the user needs
 * to know either appears in the dashboard or in a dialog - never on stdout.
 */
import { spawn } from 'node:child_process';
import { config } from './core/config.js';
import { log } from './core/logger.js';
import { alertUser } from './core/notify.js';
import { hunter } from './hunter.js';
import { startWebServer, AlreadyRunning } from './web/server.js';

function openBrowser(url: string): void {
  if (process.env.AUTO_OPEN === 'false') return;
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* headless box - the URL is printed anyway */
  }
}

async function main(): Promise<void> {
  const url = 'http://' + config.webHost + ':' + config.webPort;

  try {
    await startWebServer();
  } catch (err) {
    if (err instanceof AlreadyRunning) {
      // Double-clicked twice. Just show them the copy already running.
      openBrowser(err.url);
      process.exit(0);
    }
    alertUser(
      'RH Freemint Hunter could not start',
      (err as Error).message + '\n\nDetails were saved to startup-error.log next to the program.',
    );
    process.exit(1);
  }

  openBrowser(url);

  const stop = async () => {
    await hunter.shutdown('process signal (Ctrl+C or window closed)');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  log.error('Fatal', err);
  alertUser(
    'RH Freemint Hunter stopped unexpectedly',
    String((err as Error)?.message ?? err) + '\n\nDetails were saved to startup-error.log.',
  );
  process.exit(1);
});
