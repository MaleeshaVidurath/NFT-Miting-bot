import { formatEther } from 'ethers';
import { config } from '../../core/config.js';
import { log } from '../../core/logger.js';
import { currencyOf, formatMoney } from './currencies.js';

const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price';

const cache = new Map<string, { rate: number; at: number }>();

/**
 * ETH priced in a fiat currency, cached per currency.
 *
 * ETH_PRICE_OVERRIDE pins the rate, which keeps eligibility decisions
 * deterministic and removes a network dependency from the mint hot path. It is
 * interpreted in the currently selected currency.
 */
export async function getEthRate(code = config.currency): Promise<number | undefined> {
  const cur = currencyOf(code).code;
  if (config.ethPriceOverride) return config.ethPriceOverride;

  const hit = cache.get(cur);
  if (hit && Date.now() - hit.at < config.priceCacheMs) return hit.rate;

  try {
    const url = COINGECKO + '?ids=ethereum&vs_currencies=' + encodeURIComponent(cur);
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      // Without this the request can hang indefinitely, and anything awaiting
      // it hangs too - which is how the whole dashboard used to stall.
      signal: AbortSignal.timeout(config.priceTimeoutMs),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const body = (await res.json()) as { ethereum?: Record<string, number> };
    const rate = body.ethereum?.[cur];
    if (typeof rate !== 'number' || rate <= 0) throw new Error('no rate for ' + cur);
    cache.set(cur, { rate, at: Date.now() });
    return rate;
  } catch (err) {
    log.warn('ETH price fetch failed (' + cur + '): ' + (err as Error).message);
    // A stale rate beats no rate; better than silently treating a mint as free.
    return cache.get(cur)?.rate;
  }
}

/** Backwards-compatible alias - the dashboard still calls this "eth price". */
export const getEthUsd = getEthRate;

/**
 * Whatever rate is already known, without waiting on the network.
 *
 * The dashboard polls status every few seconds; it must never block on a
 * third-party price feed. A refresh is kicked off in the background so the
 * value appears on a later poll.
 */
export function getEthRateCached(code = config.currency): number | undefined {
  if (config.ethPriceOverride) return config.ethPriceOverride;
  const cur = currencyOf(code).code;
  const hit = cache.get(cur);

  const stale = !hit || Date.now() - hit.at >= config.priceCacheMs;
  if (stale && !inFlight.has(cur)) {
    inFlight.add(cur);
    void getEthRate(code).finally(() => inFlight.delete(cur));
  }
  return hit?.rate;
}

/** Currencies with a refresh already running, so we do not stack requests. */
const inFlight = new Set<string>();

/** Convert wei to the active currency. Undefined when no rate is available. */
export async function weiToFiat(wei: bigint, code = config.currency): Promise<number | undefined> {
  const rate = await getEthRate(code);
  if (rate === undefined) return undefined;
  return Number(formatEther(wei)) * rate;
}

/**
 * Ratio for restating an amount from one currency into another.
 * Derived from ETH's price in each, so no separate FX feed is needed.
 */
export async function conversionFactor(from: string, to: string): Promise<number | undefined> {
  if (currencyOf(from).code === currencyOf(to).code) return 1;
  const [a, b] = await Promise.all([getEthRate(from), getEthRate(to)]);
  if (!a || !b) return undefined;
  return b / a;
}

export function money(amount: number, code = config.currency): string {
  return formatMoney(amount, code);
}
