import { config } from './core/config.js';
import { log } from './core/logger.js';
import { bus } from './core/events.js';
import { detectors, assertDetectorsConfigured, type MintCandidate } from './flow/01-scan/index.js';
import { verifyConnection, shutdown, resetProviders } from './flow/02-chain/index.js';
import { inspectDrop, UpcomingWatchlist, formatDrop, type DropInfo } from './flow/03-drops/index.js';
import { ledger } from './flow/08-save/index.js';
import { handleDrop, screenUpcoming, mintQueue } from './pipeline.js';
import { publishDrop } from './flow/03-drops/registry.js';

/**
 * The bot as a controllable object, so both the CLI and the dashboard can
 * drive it. Nothing starts at import time.
 */
export class Hunter {
  private seen = new Set<string>();
  private watchlist = new UpcomingWatchlist(handleDrop);
  private statusTimer: NodeJS.Timeout | undefined;
  private active = false;

  get running(): boolean {
    return this.active;
  }

  get stats() {
    return {
      running: this.active,
      watching: this.watchlist.size,
      queued: mintQueue.pending,
      seen: this.seen.size,
      ledger: ledger.stats,
    };
  }

  /** Drops currently queued for a future mint. */
  upcoming(): DropInfo[] {
    return this.watchlist.list();
  }

  async start(): Promise<void> {
    if (this.active) {
      log.warn('Hunter already running');
      return;
    }
    this.active = true;
    bus.emitTyped('state', { running: true });

    // Settings may have changed since the last run - rebuild against current config.
    resetProviders();

    log.info('RH free mint hunter starting - chain=' + config.chain + ' dryRun=' + config.dryRun);
    if (!config.dryRun) log.warn('DRY_RUN is OFF - this run can broadcast real transactions');

    await verifyConnection();
    ledger.load();
    assertDetectorsConfigured();

    for (const d of detectors) {
      await d.start((c) => this.onCandidate(c));
      log.info('Detector started: ' + d.name);
    }

    this.statusTimer = setInterval(() => log.info('Status', this.stats), config.watchRecheckMs);
    this.statusTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;

    if (this.statusTimer) clearInterval(this.statusTimer);
    this.watchlist.stop();
    for (const d of detectors) await d.stop().catch(() => {});

    log.info('Hunter stopped', this.stats);
    bus.emitTyped('state', { running: false });
  }

  /** Full teardown, including RPC sockets. Used on process exit. */
  async shutdown(): Promise<void> {
    await this.stop();
    await shutdown();
  }

  private async onCandidate(candidate: MintCandidate): Promise<void> {
    if (!this.active) return;

    // Event-driven detectors carry a tx hash: a second PublicDropUpdated for
    // the same token means the creator CHANGED the schedule, so it must be
    // re-inspected rather than skipped. Polling detectors dedupe by address.
    const tx = (candidate.evidence?.tx as string | undefined) ?? '';
    const key = candidate.source + ':' + candidate.address.toLowerCase() + ':' + tx;
    if (this.seen.has(key)) return;
    this.seen.add(key);

    let drop: DropInfo;
    try {
      drop = await inspectDrop(candidate.address);
    } catch (err) {
      log.warn('Inspect failed for ' + candidate.address, (err as Error).message);
      return;
    }

    log.info('Candidate (' + candidate.source + '): ' + formatDrop(drop));
    publishDrop(drop);

    switch (drop.status) {
      case 'upcoming':
        // Screen before queuing so an ineligible project is never watched.
        // It is re-evaluated when it opens, since price and credibility change.
        if (await screenUpcoming(drop)) this.watchlist.add(drop);
        return;

      case 'live':
        await handleDrop(drop);
        return;

      case 'unknown':
        if (config.mintUnknownSchedule) await handleDrop(drop);
        return;

      default:
        log.debug('Ignoring ' + drop.status + ' drop ' + drop.address);
    }
  }
}

export const hunter = new Hunter();
