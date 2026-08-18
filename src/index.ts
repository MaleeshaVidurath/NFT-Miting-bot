import { config } from './core/config.js';
import { log } from './core/logger.js';
import { detectors, assertDetectorsConfigured, type MintCandidate } from './flow/01-scan/index.js';
import { verifyConnection, shutdown } from './flow/02-chain/index.js';
import { inspectDrop, UpcomingWatchlist, formatDrop, type DropInfo } from './flow/03-drops/index.js';
import { guard } from './flow/07-mint/index.js';
import { ledger } from './flow/08-save/index.js';
import { handleDrop, screenUpcoming, mintQueue } from './pipeline.js';

const seen = new Set<string>();

const watchlist = new UpcomingWatchlist(handleDrop);

async function onCandidate(candidate: MintCandidate): Promise<void> {
  // Event-driven detectors carry a tx hash: a second PublicDropUpdated for the
  // same token means the creator CHANGED the schedule, so it must be
  // re-inspected rather than skipped. Polling detectors have no tx and dedupe
  // by address alone.
  const tx = (candidate.evidence?.tx as string | undefined) ?? '';
  const key = candidate.source + ':' + candidate.address.toLowerCase() + ':' + tx;
  if (seen.has(key)) return;
  seen.add(key);

  let drop: DropInfo;
  try {
    drop = await inspectDrop(candidate.address);
  } catch (err) {
    log.warn('Inspect failed for ' + candidate.address, (err as Error).message);
    return;
  }

  log.info('Candidate (' + candidate.source + '): ' + formatDrop(drop));

  switch (drop.status) {
    case 'upcoming':
      // Screen before queuing so an ineligible project is never watched.
      // It is re-evaluated when it opens, since price and credibility change.
      if (await screenUpcoming(drop)) watchlist.add(drop);
      return;

    case 'live':
      await handleDrop(drop);
      return;

    case 'unknown':
      if (config.mintUnknownSchedule) {
        log.debug('Unknown schedule, attempting anyway: ' + drop.address);
        await handleDrop(drop);
      }
      return;

    default:
      log.debug('Ignoring ' + drop.status + ' drop ' + drop.address);
  }
}

async function main(): Promise<void> {
  log.info('RH free mint hunter starting - chain=' + config.chain + ' dryRun=' + config.dryRun);
  if (!config.dryRun) log.warn('DRY_RUN is OFF - this run can broadcast real transactions');

  await verifyConnection();
  ledger.load();
  assertDetectorsConfigured();

  for (const d of detectors) {
    await d.start(onCandidate);
    log.info('Detector started: ' + d.name);
  }

  const status = setInterval(() => {
    log.info(
      'Status: ' + watchlist.size + ' upcoming, ' + mintQueue.pending + ' queued, seen ' + seen.size,
      { ...guard.stats, ledger: ledger.stats },
    );
  }, config.watchRecheckMs);
  status.unref?.();

  const stop = async () => {
    log.info('Shutting down...', { ...guard.stats, ledger: ledger.stats });
    clearInterval(status);
    watchlist.stop();
    for (const d of detectors) await d.stop().catch(() => {});
    await shutdown();
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  log.error('Fatal', err);
  process.exit(1);
});
