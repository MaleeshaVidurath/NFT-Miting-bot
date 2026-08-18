import { formatEther } from 'ethers';
import { config } from '../../core/config.js';
import { log } from '../../core/logger.js';

const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';

let cached: { usd: number; at: number } | undefined;

/**
 * ETH/USD, cached. Robinhood Chain pays gas and mint prices in ETH.
 *
 * ETH_USD_PRICE pins the rate, which keeps eligibility decisions deterministic
 * and removes a network dependency from the mint hot path.
 */
export async function getEthUsd(): Promise<number | undefined> {
  if (config.ethUsdOverride) return config.ethUsdOverride;

  const fresh = cached && Date.now() - cached.at < config.priceCacheMs;
  if (fresh) return cached!.usd;

  try {
    const res = await fetch(COINGECKO, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = (await res.json()) as { ethereum?: { usd?: number } };
    const usd = body.ethereum?.usd;
    if (typeof usd !== 'number' || usd <= 0) throw new Error('bad payload');
    cached = { usd, at: Date.now() };
    return usd;
  } catch (err) {
    log.warn('ETH price fetch failed: ' + (err as Error).message);
    // A stale rate beats no rate; better than silently treating a mint as free.
    return cached?.usd;
  }
}

export async function weiToUsd(wei: bigint): Promise<number | undefined> {
  const rate = await getEthUsd();
  if (rate === undefined) return undefined;
  return Number(formatEther(wei)) * rate;
}
