import { Contract } from 'ethers';
import { getProvider } from '../02-chain/provider.js';
import { log } from '../../core/logger.js';
import { ledger } from '../08-save/ledger.js';

export interface MintedCheck {
  minted: boolean;
  /** Where the answer came from, for the log. */
  source: 'ledger' | 'getMintStats' | 'balanceOf' | 'none';
  count?: bigint;
}

const ABI = [
  'function getMintStats(address) view returns (uint256,uint256,uint256)',
  'function balanceOf(address) view returns (uint256)',
];

async function read(address: string, fn: string, wallet: string): Promise<unknown[] | undefined> {
  try {
    const c = new Contract(address, ABI, getProvider());
    const r = await c.getFunction(fn).staticCall(wallet);
    return Array.isArray(r) ? (r as unknown[]) : [r];
  } catch {
    return undefined;
  }
}

/**
 * Has this wallet already minted this collection?
 *
 * The local ledger is checked first (free, no RPC), then the chain itself.
 * getMintStats is authoritative for SeaDrop - it counts what the wallet minted
 * from this drop, and unlike balanceOf it is not fooled by tokens that were
 * transferred away or bought on the secondary market.
 */
export async function hasWalletMinted(wallet: string, address: string): Promise<MintedCheck> {
  if (ledger.hasMinted(wallet, address)) {
    return { minted: true, source: 'ledger' };
  }

  const stats = await read(address, 'getMintStats', wallet);
  if (stats && stats[0] !== undefined) {
    const count = BigInt(stats[0] as bigint);
    return { minted: count > 0n, source: 'getMintStats', count };
  }

  // Fallback for non-SeaDrop collections. Weaker: a wallet that sold its token
  // reads as never having minted, and one that bought reads as having minted.
  const bal = await read(address, 'balanceOf', wallet);
  if (bal && bal[0] !== undefined) {
    const count = BigInt(bal[0] as bigint);
    return { minted: count > 0n, source: 'balanceOf', count };
  }

  log.debug('No mint-history source for ' + address);
  return { minted: false, source: 'none' };
}
