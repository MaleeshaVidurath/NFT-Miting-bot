/**
 * Headless entry point. The dashboard lives in src/web - see `npm run ui`.
 */
import { log } from './core/logger.js';
import { hunter } from './hunter.js';

async function main(): Promise<void> {
  await hunter.start();

  const stop = async () => {
    await hunter.shutdown('process signal (Ctrl+C or window closed)');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  log.error('Fatal', err);
  process.exit(1);
});
