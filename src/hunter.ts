import { config } from './core/config.js';
import { log } from './core/logger.js';
import { bus } from './core/events.js';
import { clearBeats, heartbeats, stale } from './core/health.js';
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
      heartbeats: heartbeats(),
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

    // Starting a detector runs its first sweep, which for the on-chain scanner
    // means a block backfill lasting tens of seconds. Stop can land in the
    // middle of that, so re-check between every step - otherwise the loop
    // carries on and starts scanners after the bot has been stopped.
    for (const d of detectors) {
      if (!this.active) break;
      await d.start((c) => this.onCandidate(c));
      if (!this.active) {
        // Stopped while this one was starting: undo it and give up on the rest.
        await d.stop().catch(() => {});
        log.info('Startup cancelled - hunter was stopped while starting ' + d.name);
        return;
      }
      log.info('Detector started: ' + d.name);
    }

    if (!this.active) {
      log.info('Startup cancelled - hunter was stopped during startup');
      return;
    }

    clearBeats();
    this.statusTimer = setInterval(() => {
      log.info('Status', this.stats);
      // A scanner that stopped rescheduling itself would otherwise be silent.
      const quiet = stale(config.pollIntervalMs * 4);
      for (const h of quiet) {
        log.warn('Scanner "' + h.detector + '" has not run for ' + h.secondsAgo + 's - it may have stalled');
      }
    }, config.watchRecheckMs);
    this.statusTimer.unref?.();
  }

  /**
   * @param reason who asked, so an unexpected stop leaves evidence in the log
   *   rather than the bot just going quiet.
   */
  async stop(reason = 'unspecified'): Promise<void> {
    if (!this.active) return;
    this.active = false;
    log.info('Hunter stopping - requested by: ' + reason);

    if (this.statusTimer) clearInterval(this.statusTimer);
    this.watchlist.stop();
    for (const d of detectors) await d.stop().catch(() => {});

    log.info('Hunter stopped', this.stats);
    bus.emitTyped('state', { running: false });
  }

  /** Full teardown, including RPC sockets. Used on process exit. */
  async shutdown(reason = 'process exit'): Promise<void> {
    await this.stop(reason);
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

    // Inspecting took a network round trip; the user may have pressed Stop
    // during it. Acting now would queue a mint or a timer on a stopped bot.
    if (!this.active) return;

    log.info('Candidate (' + candidate.source + '): ' + formatDrop(drop));
    publishDrop(drop);

    switch (drop.status) {
      case 'upcoming': {
        // Screen before queuing so an ineligible project is never watched.
        // It is re-evaluated when it opens, since price and credibility change.
        const eligible = await screenUpcoming(drop);
        if (eligible && this.active) this.watchlist.add(drop);
        return;
      }

      case 'live':
        if (this.active) await handleDrop(drop);
        return;

      case 'unknown':
        if (config.mintUnknownSchedule && this.active) await handleDrop(drop);
        return;

      default:
        log.debug('Ignoring ' + drop.status + ' drop ' + drop.address);
    }
  }
}

export const hunter = new Hunter();
