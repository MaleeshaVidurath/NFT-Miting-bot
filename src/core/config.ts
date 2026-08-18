import dotenv from 'dotenv';
import { parseEther, parseUnits } from 'ethers';

/**
 * Where settings are read from and written to.
 *
 * Docker sets this to a path inside a mounted directory: bind-mounting a
 * single file makes the atomic write-then-rename in settings.ts fail, because
 * the file itself is the mount point and cannot be replaced.
 */
export const ENV_FILE = process.env.ENV_FILE || '.env';

dotenv.config({ path: ENV_FILE });

export type ChainName = 'robinhood' | 'robinhood-testnet' | 'ethereum' | 'base' | 'arbitrum';

export interface ChainMeta {
  label: string;
  chainId: number;
  /** Public RPC used when RPC_HTTP_URL is blank. */
  rpc?: string;
  /** Blockscout instance for credibility signals. Blank = signals degrade. */
  explorer?: string;
  /** OpenSea's slug for this chain. */
  openSeaSlug: string;
}

/**
 * Everything that changes when the user switches network.
 *
 * Keeping these together means adding a chain is one entry, and nothing
 * downstream has to special-case Robinhood.
 */
export const CHAINS: Record<ChainName, ChainMeta> = {
  robinhood: {
    label: 'Robinhood Chain',
    chainId: 4663,
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
    explorer: 'https://robinhoodchain.blockscout.com',
    openSeaSlug: 'robinhood',
  },
  'robinhood-testnet': {
    label: 'Robinhood Chain (testnet)',
    chainId: 46630,
    rpc: 'https://rpc.testnet.chain.robinhood.com',
    openSeaSlug: 'robinhood',
  },
  ethereum: {
    label: 'Ethereum',
    chainId: 1,
    rpc: 'https://ethereum-rpc.publicnode.com',
    explorer: 'https://eth.blockscout.com',
    openSeaSlug: 'ethereum',
  },
  base: {
    label: 'Base',
    chainId: 8453,
    rpc: 'https://mainnet.base.org',
    explorer: 'https://base.blockscout.com',
    openSeaSlug: 'base',
  },
  arbitrum: {
    label: 'Arbitrum',
    chainId: 42161,
    rpc: 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://arbitrum.blockscout.com',
    openSeaSlug: 'arbitrum',
  },
};

export const CHAIN_NAMES = Object.keys(CHAINS) as ChainName[];

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

function build() {
  const chain = (process.env.CHAIN ?? 'robinhood') as ChainName;
  const meta = CHAINS[chain];
  if (!meta) {
    throw new Error(`Unsupported CHAIN: ${chain}. Use one of: ${CHAIN_NAMES.join(', ')}`);
  }

  const rpcHttpUrl = process.env.RPC_HTTP_URL || meta.rpc;
  if (!rpcHttpUrl) {
    throw new Error(
      `${meta.label} has no built-in public RPC. Set a custom RPC URL in settings.`,
    );
  }

  return {
    chain,
    chainMeta: meta,
    chainId: meta.chainId,
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
    openSeaChain: process.env.OPENSEA_CHAIN || meta.openSeaSlug,
    // Where drops are scanned from. A chain page scans every collection on that
    // chain; a collection page scans just that one. Changeable from the UI.
    openSeaUrl: process.env.OPENSEA_URL || 'https://opensea.io/collections/chain/' + meta.openSeaSlug,
    openSeaApiBase: process.env.OPENSEA_API_BASE ?? 'https://api.opensea.io/api/v2',
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
    // Currency the price cap is expressed and displayed in
    currency: (process.env.CURRENCY ?? 'usd').toLowerCase(),
    // Hard cap on a paid mint's price, in the currency above.
    // MAX_PAID_MINT_USD is the old name, still honoured.
    maxPaidMintPrice: num('MAX_PAID_MINT_PRICE', num('MAX_PAID_MINT_USD', 1)),
    // Pin the ETH rate instead of fetching it (0 = fetch live)
    ethPriceOverride: num('ETH_PRICE_OVERRIDE', num('ETH_USD_PRICE', 0)) || undefined,
    priceCacheMs: num('PRICE_CACHE_MS', 300000),
    priceTimeoutMs: num('PRICE_TIMEOUT_MS', 6000),
    explorerApiBase: process.env.EXPLORER_API_BASE || meta.explorer || '',
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

    // --- Logging to file ---
    // Written next to the program; the packaged build has no console window.
    logFile: process.env.LOG_FILE ?? 'hunter.log',
    logFileMaxBytes: num('LOG_FILE_MAX_BYTES', 5_000_000),

    // --- Persistence ---
    ledgerPath: process.env.LEDGER_PATH ?? 'data/mints.json',

    // --- Web dashboard ---
    webPort: num('WEB_PORT', 4663),
    webHost: process.env.WEB_HOST ?? '127.0.0.1',

    logLevel: (process.env.LOG_LEVEL ?? 'info') as 'debug' | 'info' | 'warn' | 'error',
  };
}

export type Config = ReturnType<typeof build>;

/**
 * Live config object.
 *
 * The identity of this object never changes, so every module that imported it
 * sees updates after reloadConfig(). That is what lets the dashboard change
 * settings without restarting the process.
 */
export const config: Config = build();

/** Re-read .env from disk and refresh `config` in place. */
export function reloadConfig(): void {
  dotenv.config({ path: ENV_FILE, override: true });
  Object.assign(config, build());
}
