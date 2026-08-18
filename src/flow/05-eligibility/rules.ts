import { config } from '../../core/config.js';
import type { DropInfo } from '../03-drops/types.js';
import { scoreCredibility, type CredibilityReport } from '../04-analyze/credibility.js';
import { weiToFiat, money } from '../04-analyze/price.js';

export interface Eligibility {
  eligible: boolean;
  /** "free" | "paid" - which branch of the decision tree was taken. */
  branch: 'free' | 'paid';
  reason: string;
  credibility?: CredibilityReport;
  priceUsd?: number;
  currency?: string;
}

/**
 * The eligibility rule:
 *
 *   FREE MINT  -> eligible, credibility does not matter
 *   PAID MINT  -> eligible only if credibility >= MIN_CREDIBILITY
 *                 AND price <= MAX_PAID_MINT_USD
 *
 * A credibility veto (explorer flags the token as a scam) blocks the paid
 * branch outright, whatever the numeric score.
 */
export async function evaluate(drop: DropInfo): Promise<Eligibility> {
  const priceWei = drop.priceWei ?? 0n;
  const isFree = priceWei === 0n;

  if (isFree) {
    // Per spec, credibility does not gate free mints. A scam VETO is a
    // different thing from a low score, so it can optionally still block -
    // off by default to match the rule as written.
    if (config.vetoAppliesToFree) {
      const credibility = await scoreCredibility(drop);
      if (credibility.veto) {
        return {
          eligible: false,
          branch: 'free',
          reason: 'vetoed - ' + credibility.veto,
          credibility,
        };
      }
    }
    return { eligible: true, branch: 'free', reason: 'free mint - credibility not required' };
  }

  // Paid branch: price gate first, it is cheap and rejects most candidates.
  const priceUsd = await weiToFiat(priceWei);
  if (priceUsd === undefined) {
    return {
      eligible: false,
      branch: 'paid',
      reason: 'Exchange rate unavailable - cannot verify the price cap, refusing to guess',
    };
  }
  if (priceUsd > config.maxPaidMintPrice) {
    return {
      eligible: false,
      branch: 'paid',
      reason: 'price ' + money(priceUsd) + ' exceeds ' + money(config.maxPaidMintPrice) + ' cap',
      priceUsd,
      currency: config.currency,
    };
  }

  const credibility = await scoreCredibility(drop);
  if (credibility.veto) {
    return {
      eligible: false,
      branch: 'paid',
      reason: 'vetoed - ' + credibility.veto,
      credibility,
      priceUsd,
      currency: config.currency,
    };
  }
  if (credibility.score < config.minCredibility) {
    return {
      eligible: false,
      branch: 'paid',
      reason: 'credibility ' + credibility.score + '/100 below ' + config.minCredibility,
      credibility,
      priceUsd,
      currency: config.currency,
    };
  }

  return {
    eligible: true,
    branch: 'paid',
    reason: 'credibility ' + credibility.score + '/100 and price ' + money(priceUsd),
    credibility,
    priceUsd,
    currency: config.currency,
  };
}

export function formatEligibility(e: Eligibility): string {
  return (e.eligible ? 'ELIGIBLE' : 'rejected') + ' [' + e.branch + '] ' + e.reason;
}
