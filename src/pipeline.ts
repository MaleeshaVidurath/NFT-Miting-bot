/**
 * The bot flow, in order.
 *
 *   [01-scan]        Scan OpenSea Drops
 *   [02-chain]       Robinhood Chain only
 *   [03-drops]       New / upcoming drops
 *   [04-analyze]     Analyze each project
 *   [05-eligibility] FREE -> eligible | PAID -> credibility >= 75 AND <= $1
 *   [06-wallet]      Wallet already minted it?   YES -> SKIP
 *   [07-mint]        NO -> MINT 1
 *   [08-save]        Save result
 *   [09-next]        Move to next
 *
 * Each step lives in the matching folder under src/flow.
 */
import { config } from './core/config.js';
import { log } from './core/logger.js';
import { getWallet } from './flow/02-chain/index.js';
import { formatDrop, type DropInfo } from './flow/03-drops/index.js';
import { evaluate, formatEligibility } from './flow/05-eligibility/index.js';
import { hasWalletMinted } from './flow/06-wallet/index.js';
import { attemptMint } from './flow/07-mint/index.js';
import { ledger } from './flow/08-save/index.js';
import { SerialQueue } from './flow/09-next/index.js';

export const mintQueue = new SerialQueue();

/** Steps 6-8: already minted? -> mint 1 -> save result. */
async function mintAndRecord(drop: DropInfo): Promise<void> {
  const wallet = getWallet();
  if (!wallet) {
    log.info('Would act on ' + formatDrop(drop) + ' but no wallet is configured');
    return;
  }

  // [06-wallet] Wallet already minted it?
  const check = await hasWalletMinted(wallet.address, drop.address);
  if (check.minted) {
    log.info('SKIP ' + drop.address + ' - already minted (' + check.source +
      (check.count !== undefined ? ' count=' + check.count : '') + ')');
    // Record once so later runs answer from the ledger without an RPC call.
    if (check.source !== 'ledger') {
      ledger.record({
        address: drop.address,
        name: drop.name,
        wallet: wallet.address,
        outcome: 'skipped',
        quantity: 0,
        reason: 'already minted, per ' + check.source,
      });
    }
    return;
  }

  // A drop that keeps reverting - wrong phase, allowlist-only, sold out mid-run
  // - would otherwise be retried every time its detector re-emits it.
  const failures = ledger.failedAttempts(wallet.address, drop.address);
  if (failures >= config.maxAttemptsPerContract) {
    log.info('SKIP ' + drop.address + ' - ' + failures + ' failed attempts, giving up');
    return;
  }

  // [07-mint] MINT 1
  const result = await attemptMint(drop, 1);

  // [08-save] Save result
  const outcome = result.txHash ? 'minted' : result.reason === 'dry run' ? 'dry-run' : 'failed';

  ledger.record({
    address: drop.address,
    name: drop.name,
    wallet: wallet.address,
    outcome,
    txHash: result.txHash,
    quantity: 1,
    priceWei: drop.priceWei?.toString(),
    reason: result.reason,
  });

  log.info('Result ' + drop.address + ': ' + outcome + (result.txHash ? ' tx=' + result.txHash : '') +
    (result.reason ? ' (' + result.reason + ')' : ''));
}

/**
 * Steps 5-9 for a drop that is open now.
 * Returns as soon as the work is queued; [09-next] runs it in turn.
 */
export async function handleDrop(drop: DropInfo): Promise<void> {
  const verdict = await evaluate(drop);
  log.info(formatEligibility(verdict) + ' - ' + drop.address + ' ' + (drop.name ?? ''));
  if (!verdict.eligible) return;

  await mintQueue.push(drop.address, () => mintAndRecord(drop));
}

/** Step 5 applied early, so an ineligible project is never put on the watchlist. */
export async function screenUpcoming(drop: DropInfo): Promise<boolean> {
  const verdict = await evaluate(drop);
  log.info(formatEligibility(verdict) + ' - upcoming ' + drop.address + ' ' + (drop.name ?? ''));
  return verdict.eligible || config.watchIneligible;
}
