import 'dotenv/config';
import { parseEther, parseUnits } from 'ethers';

export type ChainName = 'robinhood' | 'robinhood-testnet' | 'ethereum' | 'base' | 'arbitrum';

const CHAIN_IDS: Record<ChainName, number> = {
  robinhood: 4663,
  'robinhood-testnet': 46630,
  ethereum: 1,
  base: 8453,
  arbitrum: 42161,
};

/** Public RPC fallbacks, used when RPC_HTTP_URL is not set. */
const DEFAULT_RPC: Partial<Record<ChainName, string>> = {
  robinhood: 'https://rpc.mainnet.chain.robinhood.com',
  'robinhood-testnet': 'https://rpc.testnet.chain.robinhood.com',
};

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be a number, got: ${v}`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v.toLowerCase() === 'true' || v === '1';
}

const chain = (process.env.CHAIN ?? 'robinhood') as ChainName;
if (!(chain in CHAIN_IDS)) {
  throw new Error(`Unsupported CHAIN: ${chain}. Use one of: ${Object.keys(CHAIN_IDS).join(', ')}`);
}

const rpcHttpUrl = process.env.RPC_HTTP_URL || DEFAULT_RPC[chain];
if (!rpcHttpUrl) {
  throw new Error(`No RPC for CHAIN=${chain}. Set RPC_HTTP_URL in .env`);
}

export const config = {
  chain,
  chainId: CHAIN_IDS[chain],
  rpcHttpUrl,
  rpcWsUrl: process.env.RPC_WS_URL || undefined,
  privateKey: process.env.PRIVATE_KEY || undefined,

  // Safety rails. Defaults are deliberately conservative: nothing is broadcast
  // unless DRY_RUN is explicitly turned off.
  dryRun: bool('DRY_RUN', true),
  maxGasPriceWei: parseUnits(String(num('MAX_GAS_GWEI', 30)), 'gwei'),
  maxMintValueWei: parseEther(String(num('MAX_MINT_VALUE_ETH', 0))),
  dailyGasBudgetWei: parseEther(String(num('DAILY_GAS_BUDGET_ETH', 0.05))),
  maxMintsPerContract: num('MAX_MINTS_PER_CONTRACT', 1),
  maxMintsPerRun: num('MAX_MINTS_PER_RUN', 5),

  // --- OpenSea ---
  openSeaApiKey: process.env.OPENSEA_API_KEY || undefined,
  openSeaChain: process.env.OPENSEA_CHAIN ?? 'robinhood',
  openSeaPageSize: num('OPENSEA_PAGE_SIZE', 50),
  pollIntervalMs: num('POLL_INTERVAL_MS', 30000),

  // --- SeaDrop ---
  // Canonical SeaDrop v1, deployed at the same address on every chain OpenSea supports.
  seaDropAddress: process.env.SEADROP_ADDRESS ?? '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5',

  // How far back to backfill SeaDrop schedule events on startup
  seaDropBackfillBlocks: num('SEADROP_BACKFILL_BLOCKS', 20000),
  // Max block span per eth_getLogs call
  logChunkSize: num('LOG_CHUNK_SIZE', 5000),

  // --- Eligibility ---
  // Paid mints must score at least this to be eligible. Free mints bypass it.
  minCredibility: num('MIN_CREDIBILITY', 75),
  // Let an explorer scam-flag block free mints too (spec says free bypasses)
  vetoAppliesToFree: bool('VETO_APPLIES_TO_FREE', false),
  // Hard USD cap on a paid mint's price
  maxPaidMintUsd: num('MAX_PAID_MINT_USD', 1),
  // Pin ETH/USD instead of fetching it (0 = fetch live)
  ethUsdOverride: num('ETH_USD_PRICE', 0) || undefined,
  priceCacheMs: num('PRICE_CACHE_MS', 300000),
  explorerApiBase: process.env.EXPLORER_API_BASE ?? 'https://robinhoodchain.blockscout.com',
  explorerTimeoutMs: num('EXPLORER_TIMEOUT_MS', 8000),

  // --- Drop watching ---
  // Keep watching upcoming drops that failed eligibility (they may improve)
  watchIneligible: bool('WATCH_INELIGIBLE', false),
  // How often an upcoming drop is re-inspected on-chain
  watchRecheckMs: num('WATCH_RECHECK_MS', 300000),
  // Wake this long before a scheduled start so the mint can be armed
  armLeadMs: num('ARM_LEAD_MS', 15000),
  // Mint drops with an unreadable schedule? Off by default - noisy.
  mintUnknownSchedule: bool('MINT_UNKNOWN_SCHEDULE', false),

  // Give up on a contract after this many failed mint attempts
  maxAttemptsPerContract: num('MAX_ATTEMPTS_PER_CONTRACT', 3),

  // --- Persistence ---
  ledgerPath: process.env.LEDGER_PATH ?? 'data/mints.json',

  logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
} as const;
