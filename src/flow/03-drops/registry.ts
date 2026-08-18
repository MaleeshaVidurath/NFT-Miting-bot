import { bus, type DropEvent } from '../../core/events.js';
import type { DropInfo } from './types.js';

/**
 * Everything the bot has seen this run, newest first.
 *
 * The dashboard needs a table it can render on first load, not just a live
 * feed - a UI opened ten minutes in should still show what came before.
 */
const drops = new Map<string, DropEvent>();

function toEvent(drop: DropInfo): DropEvent {
  return {
    address: drop.address,
    name: drop.name,
    status: drop.status,
    standard: drop.standard,
    isFree: drop.isFree,
    priceWei: drop.priceWei?.toString(),
    startTime: drop.startTime,
    endTime: drop.endTime,
    maxSupply: drop.maxSupply?.toString(),
    totalMinted: drop.totalMinted?.toString(),
    seenAt: new Date().toISOString(),
  };
}

export function publishDrop(drop: DropInfo): void {
  const key = drop.address.toLowerCase();
  const event = { ...toEvent(drop), ...pickKept(drops.get(key)) };
  drops.set(key, event);
  bus.emitTyped('drop', event);
}

/** Verdict fields are set later by the eligibility step; do not lose them. */
function pickKept(prev?: DropEvent): Partial<DropEvent> {
  if (!prev) return {};
  return {
    credibility: prev.credibility,
    eligible: prev.eligible,
    reason: prev.reason,
    priceUsd: prev.priceUsd,
  };
}

/** Attach the eligibility verdict to a drop already in the registry. */
export function publishVerdict(
  address: string,
  verdict: { eligible: boolean; reason: string; credibility?: number; priceUsd?: number },
): void {
  const key = address.toLowerCase();
  const prev = drops.get(key);
  if (!prev) return;
  const event: DropEvent = { ...prev, ...verdict };
  drops.set(key, event);
  bus.emitTyped('drop', event);
}

export function allDrops(): DropEvent[] {
  return [...drops.values()].sort((a, b) => b.seenAt.localeCompare(a.seenAt));
}

export function clearDrops(): void {
  drops.clear();
}
