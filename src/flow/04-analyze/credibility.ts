import { Contract } from 'ethers';
import { getProvider } from '../02-chain/provider.js';
import { config } from '../../core/config.js';
import { log } from '../../core/logger.js';
import type { DropInfo } from '../03-drops/types.js';

export interface Signal {
  name: string;
  /** Weight in the final 0-100 score. */
  weight: number;
  /** 0..1, or undefined when the signal does not apply to this drop. */
  value?: number;
  detail: string;
}

export interface CredibilityReport {
  address: string;
  /** True when a data source could not be reached, so the score is unreliable. */
  degraded: boolean;
  /** What could not be read, for the log and the dashboard. */
  unavailable: string[];
  /** 0-100, normalised over applicable signals only. */
  score: number;
  signals: Signal[];
  /** Set when something disqualifying was found, e.g. flagged as a scam. */
  veto?: string;
}

interface BlockscoutToken {
  holders_count?: string;
  total_supply?: string;
  reputation?: string;
  name?: string;
  symbol?: string;
}

/**
 * "not found" and "could not ask" are different answers.
 *
 * Collapsing both into undefined made scores unstable: a timed-out lookup made
 * a verified contract look unverified, and dropped the holder signal from the
 * calculation entirely - which RAISES the score of a collection that has no
 * holders. A flaky network must never make a project look better.
 */
type Lookup<T> = { state: 'ok'; data: T } | { state: 'missing' } | { state: 'error'; why: string };

async function bsGet<T>(path: string): Promise<Lookup<T>> {
  if (!config.explorerApiBase) return { state: 'error', why: 'no explorer configured for this network' };
  try {
    const res = await fetch(config.explorerApiBase + path, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(config.explorerTimeoutMs),
    });
    if (res.status === 404) return { state: 'missing' };
    if (!res.ok) return { state: 'error', why: 'explorer returned ' + res.status };
    return { state: 'ok', data: (await res.json()) as T };
  } catch (err) {
    return { state: 'error', why: (err as Error).name === 'TimeoutError' ? 'explorer timed out' : 'explorer unreachable' };
  }
}

const PLACEHOLDER_NAMES = ['test', 'testing', 'untitled', 'unnamed', 'nft', 'collection', 'demo', 'sample'];

function nameQuality(name?: string): { value: number; detail: string } {
  const n = (name ?? '').trim();
  if (!n) return { value: 0, detail: 'no name' };
  const lower = n.toLowerCase();
  if (PLACEHOLDER_NAMES.includes(lower)) return { value: 0, detail: 'placeholder name "' + n + '"' };
  if (n.length < 3) return { value: 0.3, detail: 'very short name' };
  // Long strings of symbols/emoji are a common spam pattern.
  const alnum = (n.match(/[a-z0-9]/gi) ?? []).length;
  if (alnum / n.length < 0.5) return { value: 0.3, detail: 'mostly non-alphanumeric name' };
  return { value: 1, detail: '"' + n + '"' };
}

function supplySanity(max?: bigint): { value: number; detail: string } {
  if (max === undefined || max === 0n) return { value: 0.3, detail: 'no max supply' };
  const n = Number(max);
  if (n < 10) return { value: 0.4, detail: 'tiny supply ' + n };
  if (n > 100_000) return { value: 0.2, detail: 'implausible supply ' + n };
  return { value: 1, detail: 'supply ' + n };
}

function windowSanity(drop: DropInfo): { value?: number; detail: string } {
  if (!drop.startTime || !drop.endTime) return { value: undefined, detail: 'no window' };
  const hours = (drop.endTime - drop.startTime) / 3600;
  if (hours <= 0) return { value: 0, detail: 'invalid window' };
  if (hours < 0.25) return { value: 0.4, detail: 'window ' + Math.round(hours * 60) + 'm' };
  if (hours > 24 * 365) return { value: 0.3, detail: 'window > 1 year' };
  return { value: 1, detail: 'window ' + Math.round(hours) + 'h' };
}

/** Fraction of supply already claimed, as a traction signal. */
function traction(holders?: number, minted?: bigint): { value?: number; detail: string } {
  if (holders === undefined) return { value: undefined, detail: 'holders unknown' };
  if (minted !== undefined && minted === 0n) {
    return { value: undefined, detail: 'not minted yet' };
  }
  if (holders === 0) return { value: 0, detail: 'no holders' };
  if (holders >= 200) return { value: 1, detail: holders + ' holders' };
  if (holders >= 50) return { value: 0.75, detail: holders + ' holders' };
  if (holders >= 10) return { value: 0.5, detail: holders + ' holders' };
  return { value: 0.25, detail: holders + ' holders' };
}

/**
 * Score a project 0-100 from on-chain and explorer signals.
 *
 * Signals that cannot apply - traction on a drop that has not opened, a window
 * on a contract with no schedule - are excluded from the denominator rather
 * than scored zero, so an upcoming drop is not punished for being early.
 */
export async function scoreCredibility(drop: DropInfo): Promise<CredibilityReport> {
  const provider = getProvider();
  const signals: Signal[] = [];
  let veto: string | undefined;

  const tokenLookup = await bsGet<BlockscoutToken>('/api/v2/tokens/' + drop.address);
  const addrLookup = await bsGet<{ is_verified?: boolean }>('/api/v2/addresses/' + drop.address);

  const unavailable: string[] = [];
  if (tokenLookup.state === 'error') unavailable.push('token info (' + tokenLookup.why + ')');
  if (addrLookup.state === 'error') unavailable.push('contract info (' + addrLookup.why + ')');

  const token = tokenLookup.state === 'ok' ? tokenLookup.data : undefined;
  const addr = addrLookup.state === 'ok' ? addrLookup.data : undefined;

  // Explorer reputation is a hard veto, not a weighted signal.
  const reputation = token?.reputation?.toLowerCase();
  if (reputation && reputation !== 'ok' && reputation !== 'neutral') {
    veto = 'explorer reputation: ' + reputation;
  }

  // Unreachable is not the same as unverified - leave it out rather than
  // scoring a zero we cannot justify.
  const verified = addr?.is_verified === true;
  signals.push({
    name: 'contract-verified',
    weight: 20,
    value: addrLookup.state === 'error' ? undefined : verified ? 1 : 0,
    detail: addrLookup.state === 'error' ? 'could not check' : verified ? 'source verified' : 'unverified source',
  });

  const nq = nameQuality(drop.name ?? token?.name);
  signals.push({ name: 'name-quality', weight: 10, value: nq.value, detail: nq.detail });

  const ss = supplySanity(drop.maxSupply);
  signals.push({ name: 'supply-sanity', weight: 10, value: ss.value, detail: ss.detail });

  const ws = windowSanity(drop);
  signals.push({ name: 'mint-window', weight: 10, value: ws.value, detail: ws.detail });

  const holders = token?.holders_count !== undefined ? Number(token.holders_count) : undefined;
  const tr = tokenLookup.state === 'error'
    ? { value: undefined, detail: 'could not check' }
    : traction(holders, drop.totalMinted);
  signals.push({ name: 'holder-traction', weight: 15, value: tr.value, detail: tr.detail });

  // Metadata completeness: a real project sets these before launch.
  const c = new Contract(
    drop.address,
    [
      'function contractURI() view returns (string)',
      'function royaltyInfo(uint256,uint256) view returns (address,uint256)',
    ],
    provider,
  );

  let contractUri = '';
  try {
    contractUri = (await c.getFunction('contractURI').staticCall()) as string;
  } catch {
    /* not exposed */
  }
  signals.push({
    name: 'contract-metadata',
    weight: 12,
    value: contractUri && contractUri.length > 5 ? 1 : 0,
    detail: contractUri ? 'contractURI set' : 'no contractURI',
  });

  let royaltyOk = false;
  try {
    const [receiver, amount] = (await c.getFunction('royaltyInfo').staticCall(1, 10_000n)) as [string, bigint];
    royaltyOk = receiver !== '0x0000000000000000000000000000000000000000' && amount > 0n;
  } catch {
    /* not exposed */
  }
  signals.push({
    name: 'royalty-configured',
    weight: 8,
    value: royaltyOk ? 1 : 0,
    detail: royaltyOk ? 'royalties set' : 'no royalties',
  });

  // A creator payout address is required for a legitimate SeaDrop launch.
  if (drop.standard === 'seadrop') {
    let payoutOk = false;
    try {
      const sd = new Contract(
        drop.seaDropAddress ?? config.seaDropAddress,
        ['function getCreatorPayoutAddress(address) view returns (address)'],
        provider,
      );
      const payout = (await sd.getFunction('getCreatorPayoutAddress').staticCall(drop.address)) as string;
      payoutOk = payout !== '0x0000000000000000000000000000000000000000';
    } catch {
      /* leave false */
    }
    signals.push({
      name: 'creator-payout',
      weight: 15,
      value: payoutOk ? 1 : 0,
      detail: payoutOk ? 'payout address set' : 'no payout address',
    });
  }

  const applicable = signals.filter((s) => s.value !== undefined);
  const totalWeight = applicable.reduce((a, s) => a + s.weight, 0);
  const earned = applicable.reduce((a, s) => a + s.weight * (s.value ?? 0), 0);
  const score = totalWeight === 0 ? 0 : Math.round((earned / totalWeight) * 100);

  const degraded = unavailable.length > 0;
  if (degraded) {
    log.warn('Credibility for ' + drop.address + ' is incomplete: ' + unavailable.join(', '));
  }
  log.debug('Credibility ' + drop.address + ' = ' + score);
  return { address: drop.address, score, signals, veto, degraded, unavailable };
}

export function formatReport(r: CredibilityReport): string {
  const parts = r.signals
    .map((s) => s.name + '=' + (s.value === undefined ? 'n/a' : Math.round(s.value * 100) + '%'))
    .join(' ');
  return r.score + '/100 ' + (r.veto ? '[VETO ' + r.veto + '] ' : '') + parts;
}
