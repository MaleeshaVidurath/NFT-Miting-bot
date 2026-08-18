import { log } from '../../core/logger.js';
import { config } from '../../core/config.js';
import { inspectDrop } from './inspector.js';
import { formatDrop, secondsUntil, type DropInfo } from './types.js';

export type OnLive = (drop: DropInfo) => void | Promise<void>;

interface Entry {
  drop: DropInfo;
  timer: NodeJS.Timeout;
}

/**
 * Holds drops whose mint has not opened yet and wakes them up when it does.
 *
 * A drop scheduled far out is not held in a single long timer - it is
 * re-inspected periodically, so a schedule change on-chain is picked up
 * rather than trusted from first read.
 */
export class UpcomingWatchlist {
  private entries = new Map<string, Entry>();

  constructor(private readonly onLive: OnLive) {}

  get size(): number {
    return this.entries.size;
  }

  /** All tracked drops, soonest first. */
  list(): DropInfo[] {
    return [...this.entries.values()]
      .map((e) => e.drop)
      .sort((a, b) => (a.startTime ?? Infinity) - (b.startTime ?? Infinity));
  }

  add(drop: DropInfo): void {
    const key = drop.address.toLowerCase();
    const existing = this.entries.get(key);

    if (existing) {
      // Same schedule - nothing to do.
      if (existing.drop.startTime === drop.startTime) return;
      // Rescheduled on-chain: drop the stale timer and re-arm.
      log.info('Reschedule for ' + drop.address + ': ' + formatDrop(drop));
      this.remove(key);
    } else {
      log.info('Watching upcoming drop: ' + formatDrop(drop));
    }
    this.schedule(key, drop);
  }

  private schedule(key: string, drop: DropInfo): void {
    const wait = this.nextCheckMs(drop);
    const timer = setTimeout(() => void this.recheck(key), wait);
    // Do not hold the process open purely for a far-future drop.
    timer.unref?.();
    this.entries.set(key, { drop, timer });
  }

  /**
   * Wake shortly BEFORE the start time so the mint can be armed in advance,
   * but never sleep longer than the recheck ceiling.
   */
  private nextCheckMs(drop: DropInfo): number {
    if (!drop.startTime) return config.watchRecheckMs;
    const untilStart = secondsUntil(drop.startTime) * 1000;
    const armAt = untilStart - config.armLeadMs;
    if (armAt <= 0) return 0;
    return Math.min(armAt, config.watchRecheckMs);
  }

  private async recheck(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;

    let fresh: DropInfo;
    try {
      fresh = await inspectDrop(entry.drop.address);
    } catch (err) {
      log.warn('Recheck failed for ' + entry.drop.address, (err as Error).message);
      this.schedule(key, entry.drop);
      return;
    }

    switch (fresh.status) {
      case 'live':
        this.remove(key);
        log.info('Drop is LIVE: ' + formatDrop(fresh));
        try {
          await this.onLive(fresh);
        } catch (err) {
          log.error('onLive handler failed for ' + fresh.address, err);
        }
        return;

      case 'ended':
      case 'sold-out':
        this.remove(key);
        log.info('Dropping from watchlist (' + fresh.status + '): ' + fresh.address);
        return;

      default:
        // Still upcoming, or schedule moved. Reschedule against the new data.
        this.entries.delete(key);
        this.schedule(key, fresh);
    }
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) clearTimeout(entry.timer);
    this.entries.delete(key);
  }

  stop(): void {
    for (const key of [...this.entries.keys()]) this.remove(key);
  }
}
