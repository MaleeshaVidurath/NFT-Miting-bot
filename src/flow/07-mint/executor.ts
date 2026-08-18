import { Contract, ZeroAddress } from 'ethers';
import { config } from '../../core/config.js';
import { log } from '../../core/logger.js';
import { getProvider, getWallet } from '../02-chain/provider.js';
import { guard } from './guard.js';
import { SEADROP_ABI } from '../03-drops/inspector.js';
import type { DropInfo } from '../03-drops/types.js';

/**
 * Fallback entrypoints for collections that mint directly on the token.
 * SeaDrop collections do NOT use these - see mintViaSeaDrop.
 */
const DIRECT_MINT_ABI = [
  'function mint(uint256 quantity) payable',
  'function mint() payable',
  'function publicMint(uint256 quantity) payable',
  'function freeMint(uint256 quantity) payable',
];

export interface MintResult {
  attempted: boolean;
  reason?: string;
  txHash?: string;
}

interface Plan {
  to: string;
  data: string;
  value: bigint;
  label: string;
}

/**
 * SeaDrop v1: mint through the shared SeaDrop contract, which calls
 * mintSeaDrop() on the token. Minting the token directly always reverts -
 * only SeaDrop is authorised to do that.
 */
async function planSeaDrop(drop: DropInfo, quantity: number): Promise<Plan | undefined> {
  const seaDrop = drop.seaDropAddress ?? config.seaDropAddress;
  if (!drop.feeRecipient) {
    log.warn('No allowed fee recipient for ' + drop.address + ' - SeaDrop would reject the mint');
    return undefined;
  }
  const wallet = getWallet();
  if (!wallet) return undefined;

  const c = new Contract(seaDrop, SEADROP_ABI, wallet);
  const value = (drop.priceWei ?? 0n) * BigInt(quantity);

  // minterIfNotPayer = 0 means "mint to whoever pays", i.e. our wallet.
  const data = c.interface.encodeFunctionData('mintPublic', [
    drop.address,
    drop.feeRecipient,
    ZeroAddress,
    quantity,
  ]);
  return { to: seaDrop, data, value, label: 'SeaDrop.mintPublic' };
}

/** Collections that expose their own payable mint function. */
async function planDirect(drop: DropInfo, quantity: number): Promise<Plan | undefined> {
  const wallet = getWallet();
  if (!wallet) return undefined;
  const value = drop.priceWei ?? 0n;

  for (const signature of DIRECT_MINT_ABI) {
    const c = new Contract(drop.address, [signature], wallet);
    const fnName = signature.slice(9, signature.indexOf('('));
    const takesQty = signature.includes('uint256');
    const args = takesQty ? [quantity] : [];

    try {
      await c.getFunction(fnName).staticCall(...args, { value });
    } catch {
      continue;
    }
    return {
      to: drop.address,
      data: c.interface.encodeFunctionData(fnName, args),
      value,
      label: fnName + '()',
    };
  }
  return undefined;
}

/**
 * Simulate, gate, then (unless DRY_RUN) broadcast a mint.
 * Never throws - a bad candidate must not kill the hunter.
 */
export async function attemptMint(drop: DropInfo, quantity = 1): Promise<MintResult> {
  const wallet = getWallet();
  if (!wallet) return { attempted: false, reason: 'no wallet configured' };

  const qty = drop.maxPerWallet ? Math.min(quantity, drop.maxPerWallet) : quantity;
  const plan =
    drop.standard === 'seadrop'
      ? await planSeaDrop(drop, qty)
      : await planDirect(drop, qty);

  if (!plan) return { attempted: false, reason: 'no viable mint path' };

  const provider = getProvider();

  // Simulate before paying anything. A revert here costs nothing.
  let gasLimit: bigint;
  try {
    await provider.call({ ...plan, from: wallet.address });
    gasLimit = await provider.estimateGas({ ...plan, from: wallet.address });
  } catch (err) {
    const msg = (err as Error).message.slice(0, 140);
    log.info('Simulation failed for ' + drop.address + ' (' + plan.label + '): ' + msg);
    return { attempted: false, reason: 'simulation reverted' };
  }

  const fees = await provider.getFeeData();
  const gasPrice = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;

  const blocked = guard.check(drop.address, plan.value, gasPrice, gasLimit);
  if (blocked) {
    log.warn('Skipping ' + drop.address + ': ' + blocked);
    return { attempted: false, reason: blocked };
  }

  if (config.dryRun) {
    log.info(
      '[DRY RUN] would mint ' + drop.address + ' x' + qty + ' via ' + plan.label +
      ' value=' + plan.value + ' gasLimit=' + gasLimit + ' gasPrice=' + gasPrice,
    );
    return { attempted: false, reason: 'dry run' };
  }

  try {
    const sent = await wallet.sendTransaction({ ...plan, gasLimit });
    log.info('Mint sent ' + drop.address + ' tx=' + sent.hash);
    const receipt = await sent.wait();
    const cost = (receipt?.gasUsed ?? 0n) * (receipt?.gasPrice ?? gasPrice);
    guard.record(drop.address, cost + plan.value);
    log.info('Mint confirmed ' + drop.address + ' block=' + receipt?.blockNumber + ' cost=' + cost);
    return { attempted: true, txHash: sent.hash };
  } catch (err) {
    log.error('Mint failed ' + drop.address, (err as Error).message);
    return { attempted: true, reason: (err as Error).message };
  }
}
