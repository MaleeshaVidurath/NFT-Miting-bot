import { Contract, type InterfaceAbi } from 'ethers';
import { getProvider } from '../02-chain/provider.js';
import { config } from '../../core/config.js';
import { log } from '../../core/logger.js';
import type { DropInfo, DropStatus } from './types.js';

/** Call a read-only method, returning undefined instead of throwing. */
async function tryRead<T>(
  address: string,
  abi: InterfaceAbi,
  fn: string,
  args: unknown[] = [],
): Promise<T | undefined> {
  try {
    const c = new Contract(address, abi, getProvider());
    return (await c.getFunction(fn).staticCall(...args)) as T;
  } catch {
    return undefined;
  }
}

const ts = (v: unknown): number | undefined => {
  if (v === undefined || v === null) return undefined;
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : undefined;
};

interface Schedule {
  standard: string;
  priceWei?: bigint;
  startTime?: number;
  endTime?: number;
  maxSupply?: bigint;
  seaDropAddress?: string;
  feeRecipient?: string;
  maxPerWallet?: number;
}

export const SEADROP_ABI = [
  'function getPublicDrop(address) view returns (tuple(uint80 mintPrice,uint48 startTime,uint48 endTime,uint16 maxTotalMintableByWallet,uint16 feeBps,bool restrictFeeRecipients))',
  'function getAllowedFeeRecipients(address) view returns (address[])',
  'function mintPublic(address nftContract,address feeRecipient,address minterIfNotPayer,uint256 quantity) payable',
];

/**
 * OpenSea SeaDrop v1 - the schedule lives on the shared SeaDrop contract,
 * keyed by token address, NOT on the token itself.
 *
 * Tokens using this pattern expose mintSeaDrop() and updatePublicDrop(); their
 * own ABI has no schedule getter at all, so probing the token directly finds
 * nothing. Verified against live Robinhood Chain collections.
 */
async function probeSeaDrop(address: string): Promise<Schedule | undefined> {
  const d = await tryRead<Record<string, unknown>>(
    config.seaDropAddress,
    SEADROP_ABI,
    'getPublicDrop',
    [address],
  );
  if (!d) return undefined;

  // An unconfigured token returns a zeroed struct rather than reverting.
  const start = ts(d.startTime);
  const end = ts(d.endTime);
  if (start === undefined && end === undefined) return undefined;

  let feeRecipient: string | undefined;
  const recipients = await tryRead<string[]>(
    config.seaDropAddress,
    SEADROP_ABI,
    'getAllowedFeeRecipients',
    [address],
  );
  if (recipients?.length) feeRecipient = recipients[0];

  return {
    standard: 'seadrop',
    priceWei: BigInt((d.mintPrice ?? 0n) as bigint),
    startTime: start,
    endTime: end,
    seaDropAddress: config.seaDropAddress,
    feeRecipient,
    maxPerWallet: Number(d.maxTotalMintableByWallet ?? 0) || undefined,
  };
}

/** thirdweb DropERC721 claim conditions. */
async function probeThirdweb(address: string): Promise<Schedule | undefined> {
  const abi = [
    'function getActiveClaimConditionId() view returns (uint256)',
    'function getClaimConditionById(uint256) view returns (tuple(uint256 startTimestamp,uint256 maxClaimableSupply,uint256 supplyClaimed,uint256 quantityLimitPerWallet,bytes32 merkleRoot,uint256 pricePerToken,address currency,string metadata))',
  ];
  const id = await tryRead<bigint>(address, abi, 'getActiveClaimConditionId');
  if (id === undefined) return undefined;
  const c = await tryRead<Record<string, unknown>>(address, abi, 'getClaimConditionById', [id]);
  if (!c) return undefined;
  return {
    standard: 'thirdweb',
    priceWei: BigInt((c.pricePerToken ?? 0n) as bigint),
    startTime: ts(c.startTimestamp),
    maxSupply: c.maxClaimableSupply as bigint | undefined,
  };
}

/** Zora ERC721Drop saleDetails(). */
async function probeZora(address: string): Promise<Schedule | undefined> {
  const abi = [
    'function saleDetails() view returns (tuple(bool publicSaleActive,bool presaleActive,uint256 publicSalePrice,uint64 publicSaleStart,uint64 publicSaleEnd,uint64 presaleStart,uint64 presaleEnd,bytes32 presaleMerkleRoot,uint256 maxSalePurchasePerAddress,uint256 totalMinted,uint256 maxSupply))',
  ];
  const s = await tryRead<Record<string, unknown>>(address, abi, 'saleDetails');
  if (!s) return undefined;
  return {
    standard: 'zora',
    priceWei: BigInt((s.publicSalePrice ?? 0n) as bigint),
    startTime: ts(s.publicSaleStart),
    endTime: ts(s.publicSaleEnd),
    maxSupply: s.maxSupply as bigint | undefined,
  };
}

const PRICE_GETTERS = ['mintPrice', 'price', 'cost', 'publicPrice'];
const START_GETTERS = ['publicSaleStartTime', 'saleStartTime', 'startTime', 'publicSaleStart', 'mintStartTime'];
const END_GETTERS = ['publicSaleEndTime', 'saleEndTime', 'endTime'];
const FLAG_GETTERS = ['saleIsActive', 'publicSaleActive', 'mintActive', 'isMintActive', 'saleActive'];
const MAX_SUPPLY_GETTERS = ['maxSupply', 'MAX_SUPPLY', 'collectionSize', 'maxTotalSupply'];

/** Try a list of no-arg getters, returning the first that responds. */
async function firstOf<T>(address: string, names: string[], returns: string): Promise<T | undefined> {
  for (const name of names) {
    const abi = ['function ' + name + '() view returns (' + returns + ')'];
    const v = await tryRead<T>(address, abi, name);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** Common ERC721A / bespoke getters found on hand-rolled drops. */
async function probeGeneric(address: string): Promise<Schedule | undefined> {
  const priceWei = await firstOf<bigint>(address, PRICE_GETTERS, 'uint256');
  const startRaw = await firstOf<bigint>(address, START_GETTERS, 'uint256');
  const endRaw = await firstOf<bigint>(address, END_GETTERS, 'uint256');

  if (priceWei === undefined && startRaw === undefined) return undefined;
  return {
    standard: 'generic',
    priceWei,
    startTime: ts(startRaw),
    endTime: ts(endRaw),
  };
}

async function readSupply(address: string): Promise<{ total?: bigint; max?: bigint }> {
  const total = await firstOf<bigint>(address, ['totalSupply'], 'uint256');
  const max = await firstOf<bigint>(address, MAX_SUPPLY_GETTERS, 'uint256');
  return { total, max };
}

function classify(s: Schedule, supply: { total?: bigint; max?: bigint }, flag?: boolean): DropStatus {
  const now = Math.floor(Date.now() / 1000);

  if (supply.max !== undefined && supply.total !== undefined && supply.max > 0n && supply.total >= supply.max) {
    return 'sold-out';
  }
  if (s.endTime && s.endTime < now) return 'ended';
  if (s.startTime && s.startTime > now) return 'upcoming';
  if (s.startTime && s.startTime <= now) return 'live';
  if (flag !== undefined) return flag ? 'live' : 'upcoming';
  return 'unknown';
}

/**
 * Read a contract's public mint schedule.
 * Probes run most-specific first; the first that responds wins.
 */
export async function inspectDrop(address: string): Promise<DropInfo> {
  const probes = [probeSeaDrop, probeThirdweb, probeZora, probeGeneric];

  let schedule: Schedule | undefined;
  for (const probe of probes) {
    schedule = await probe(address);
    if (schedule) break;
  }

  const supply = await readSupply(address);
  const name = await firstOf<string>(address, ['name'], 'string');

  if (!schedule) {
    const flag = await firstOf<boolean>(address, FLAG_GETTERS, 'bool');
    return {
      address,
      status: flag === undefined ? 'unknown' : flag ? 'live' : 'upcoming',
      standard: flag === undefined ? 'none' : 'sale-flag',
      isFree: false,
      maxSupply: supply.max,
      totalMinted: supply.total,
      name,
    };
  }

  const flag = schedule.startTime ? undefined : await firstOf<boolean>(address, FLAG_GETTERS, 'bool');
  const status = classify(schedule, supply, flag);

  const info: DropInfo = {
    address,
    status,
    standard: schedule.standard,
    priceWei: schedule.priceWei,
    isFree: schedule.priceWei === 0n,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    maxSupply: schedule.maxSupply ?? supply.max,
    totalMinted: supply.total,
    name,
    seaDropAddress: schedule.seaDropAddress,
    feeRecipient: schedule.feeRecipient,
    maxPerWallet: schedule.maxPerWallet,
  };
  log.debug('Inspected ' + address, info);
  return info;
}
