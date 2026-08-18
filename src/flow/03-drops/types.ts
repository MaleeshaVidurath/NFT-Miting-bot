export type DropStatus =
  | 'upcoming'   // schedule known, mint has not opened yet
  | 'live'       // mint is open right now
  | 'ended'      // past its end time
  | 'sold-out'   // supply exhausted
  | 'unknown';   // no recognised schedule interface

export interface DropInfo {
  address: string;
  status: DropStatus;
  /** Which probe recognised the contract, e.g. "seadrop" | "thirdweb" | "generic" */
  standard: string;
  /** Public mint price in wei. 0 means free. Undefined when unreadable. */
  priceWei?: bigint;
  isFree: boolean;
  /** Unix seconds */
  startTime?: number;
  endTime?: number;
  maxSupply?: bigint;
  totalMinted?: bigint;
  name?: string;

  /** SeaDrop only: the SeaDrop contract that owns this schedule. */
  seaDropAddress?: string;
  /** SeaDrop only: an allowed fee recipient, required when restrictFeeRecipients is set. */
  feeRecipient?: string;
  /** Per-wallet mint cap, when the standard exposes one. */
  maxPerWallet?: number;
}

export function secondsUntil(unixSeconds: number): number {
  return unixSeconds - Math.floor(Date.now() / 1000);
}

export function formatDrop(d: DropInfo): string {
  const parts = [`${d.address} [${d.status}]`, `via ${d.standard}`];
  if (d.name) parts.push(`"${d.name}"`);
  if (d.priceWei !== undefined) parts.push(d.isFree ? 'FREE' : `price=${d.priceWei}wei`);
  if (d.startTime) {
    const t = secondsUntil(d.startTime);
    parts.push(t > 0 ? `opens in ${Math.round(t / 60)}m` : `opened ${Math.round(-t / 60)}m ago`);
  }
  if (d.maxSupply !== undefined) parts.push(`supply=${d.totalMinted ?? '?'}/${d.maxSupply}`);
  return parts.join(' ');
}
