/**
 * Dashboard entry point. Starts the web server only - the hunter itself is
 * started and stopped from the UI.
 *   npm run ui
 */
import { log } from './core/logger.js';
import { hunter } from './hunter.js';
import { startWebServer } from './web/server.js';

async function main(): Promise<void> {
  await startWebServer();

  const stop = async () => {
    await hunter.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  log.error('Fatal', err);
  process.exit(1);
});
