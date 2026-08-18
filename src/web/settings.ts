import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { formatEther, formatUnits } from 'ethers';
import { config, reloadConfig, ENV_FILE, CHAINS, CHAIN_NAMES, type ChainName } from '../core/config.js';
import { resetProviders } from '../flow/02-chain/provider.js';
import { CURRENCIES, currencyOf } from '../flow/04-analyze/currencies.js';
import { parseScanSource, SourceUrlError } from '../flow/01-scan/sourceUrl.js';

const ENV_PATH = ENV_FILE;

/** Settings the dashboard is allowed to change, with validation. */
export interface Field {
  key: string;
  label: string;
  help: string;
  type: 'text' | 'number' | 'toggle' | 'password' | 'select';
  /** value + human label, for select fields */
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  group: string;
}

export const FIELDS: Field[] = [
  {
    key: 'CHAIN', label: 'Network', group: 'Network',
    help: 'Which blockchain to hunt on. Stop the bot before changing this. ' +
          'Your wallet, balance and mint history are per-network.',
    type: 'select',
    options: CHAIN_NAMES.map((c) => ({ value: c, label: CHAINS[c].label + ' (id ' + CHAINS[c].chainId + ')' })),
  },
  {
    key: 'DRY_RUN', label: 'Practice mode', group: 'Safety',
    help: 'ON = the bot only pretends to mint. Turn OFF only when you are ready to spend real money.',
    type: 'toggle',
  },
  {
    key: 'PRIVATE_KEY', label: 'Wallet private key', group: 'Wallet',
    help: 'Use a burner wallet with only small funds. Anyone with this key controls the wallet.',
    type: 'password',
  },
  {
    key: 'MIN_CREDIBILITY', label: 'Minimum credibility for paid mints', group: 'Rules',
    help: 'Paid drops scoring below this are skipped. Free drops ignore this.',
    type: 'number', min: 0, max: 100,
  },
  {
    key: 'CURRENCY', label: 'Currency', group: 'Rules',
    help: 'The money your price limit is written in, and what prices are shown as. ' +
          'Changing this converts your limit automatically, so it keeps the same real value.',
    type: 'select',
    options: CURRENCIES.map((c) => ({ value: c.code, label: c.label + ' (' + c.symbol + ')' })),
  },
  {
    key: 'MAX_PAID_MINT_PRICE', label: 'Max price per paid mint', group: 'Rules',
    help: 'A paid drop above this price is never minted. In the currency selected above.',
    type: 'number', min: 0, max: 100000000,
  },
  {
    key: 'DAILY_GAS_BUDGET_ETH', label: 'Gas budget per run (ETH)', group: 'Safety',
    help: 'The bot stops minting once it has spent this much on fees.',
    type: 'number', min: 0, max: 10,
  },
  {
    key: 'MAX_MINTS_PER_RUN', label: 'Max mints per run', group: 'Safety',
    help: 'Hard stop after this many mints.',
    type: 'number', min: 0, max: 1000,
  },
  {
    key: 'MAX_GAS_GWEI', label: 'Max gas price (gwei)', group: 'Safety',
    help: 'Never pay more than this for a transaction.',
    type: 'number', min: 0, max: 10000,
  },
  {
    key: 'VETO_APPLIES_TO_FREE', label: 'Block flagged free mints', group: 'Rules',
    help: 'ON = skip free drops the explorer flags as scams. Recommended.',
    type: 'toggle',
  },
  {
    key: 'OPENSEA_URL', label: 'Where to scan for drops', group: 'Drop source',
    help: 'Paste an OpenSea link. A chain page scans every new collection on that chain; ' +
          'a collection page watches just that one. Default is Robinhood Chain.',
    type: 'text',
  },
  {
    key: 'OPENSEA_API_BASE', label: 'OpenSea API address (advanced)', group: 'Drop source',
    help: 'Leave alone unless you know you need a different API endpoint.',
    type: 'text',
  },
  {
    key: 'OPENSEA_API_KEY', label: 'OpenSea API key', group: 'Connections',
    help: 'Optional. Adds OpenSea as a second source of new drops.',
    type: 'password',
  },
  {
    key: 'RPC_HTTP_URL', label: 'Custom RPC URL', group: 'Connections',
    help: 'Optional. Leave blank to use the public Robinhood Chain endpoint.',
    type: 'text',
  },
  {
    key: 'POLL_INTERVAL_MS', label: 'Check for new drops every (ms)', group: 'Connections',
    help: '30000 = every 30 seconds. Lower is faster but uses more requests.',
    type: 'number', min: 2000, max: 600000,
  },
];

const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return out;
}

/**
 * The value actually in force, for settings the file does not mention.
 *
 * Showing a blank box for a setting that has a working default is misleading -
 * an unticked "Practice mode" while practice mode is on reads as "live", which
 * is the most dangerous thing this form could get wrong.
 *
 * Fields left out here are genuinely optional: blank means "not set", and that
 * is the honest thing to display.
 */
function effectiveValue(key: string): string | undefined {
  switch (key) {
    case 'CHAIN': return config.chain;
    case 'DRY_RUN': return String(config.dryRun);
    case 'MIN_CREDIBILITY': return String(config.minCredibility);
    case 'CURRENCY': return config.currency;
    case 'MAX_PAID_MINT_PRICE': return String(config.maxPaidMintPrice);
    case 'DAILY_GAS_BUDGET_ETH': return formatEther(config.dailyGasBudgetWei);
    case 'MAX_MINTS_PER_RUN': return String(config.maxMintsPerRun);
    case 'MAX_GAS_GWEI': return formatUnits(config.maxGasPriceWei, 'gwei');
    case 'VETO_APPLIES_TO_FREE': return String(config.vetoAppliesToFree);
    case 'OPENSEA_URL': return config.openSeaUrl;
    case 'OPENSEA_API_BASE': return config.openSeaApiBase;
    case 'POLL_INTERVAL_MS': return String(config.pollIntervalMs);
    // PRIVATE_KEY, OPENSEA_API_KEY, RPC_HTTP_URL: blank genuinely means unset.
    default: return undefined;
  }
}

export function readSettings(): Record<string, string> {
  const text = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const env = parseEnv(text);
  const out: Record<string, string> = {};
  for (const f of FIELDS) {
    const written = env.get(f.key);
    out[f.key] = written !== undefined && written !== ''
      ? written
      : effectiveValue(f.key) ?? '';
  }
  return out;
}

export class ValidationError extends Error {}

function validate(key: string, value: string): string {
  const field = BY_KEY.get(key);
  if (!field) throw new ValidationError('Unknown setting: ' + key);

  const v = value.trim();
  if (v === '') return '';

  if (field.type === 'select') {
    const allowed = (field.options ?? []).map((o) => o.value);
    if (!allowed.includes(v)) throw new ValidationError(field.label + ' must be one of: ' + allowed.join(', '));
    if (key === 'CHAIN') {
      const meta = CHAINS[v as ChainName];
      // Catch the dead end now: some chains have no public RPC built in.
      if (!meta.rpc && !readSettings().RPC_HTTP_URL) {
        throw new ValidationError(
          meta.label + ' has no built-in public RPC. Fill in "Custom RPC URL" first, then switch network.',
        );
      }
    }
    return v;
  }
  if (field.type === 'toggle') {
    if (v !== 'true' && v !== 'false') throw new ValidationError(field.label + ' must be true or false');
    return v;
  }
  if (field.type === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new ValidationError(field.label + ' must be a number');
    if (field.min !== undefined && n < field.min) throw new ValidationError(field.label + ' must be at least ' + field.min);
    if (field.max !== undefined && n > field.max) throw new ValidationError(field.label + ' must be at most ' + field.max);
    return String(n);
  }
  if (key === 'PRIVATE_KEY' && !/^0x[0-9a-fA-F]{64}$/.test(v)) {
    throw new ValidationError('Private key must start with 0x and be 66 characters long');
  }
  if (key === 'RPC_HTTP_URL' && !/^https?:\/\//.test(v)) {
    throw new ValidationError('RPC URL must start with http:// or https://');
  }
  if (key === 'OPENSEA_API_BASE' && !/^https?:\/\//.test(v)) {
    throw new ValidationError('API address must start with http:// or https://');
  }
  if (key === 'OPENSEA_URL') {
    // Reject a source the scanner could not act on, while it can still be fixed.
    try {
      parseScanSource(v);
    } catch (err) {
      throw new ValidationError(err instanceof SourceUrlError ? err.message : String(err));
    }
  }
  return v;
}

/**
 * Merge changes into .env, preserving comments and unmanaged keys.
 * Written via temp file + rename so an interrupted save cannot truncate .env.
 */
export function writeSettings(changes: Record<string, string>): void {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(changes)) clean[k] = validate(k, String(v ?? ''));

  const existing = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : '';
  const lines = existing.split(/\r?\n/);
  const handled = new Set<string>();

  const next = lines.map((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return raw;
    const eq = line.indexOf('=');
    if (eq === -1) return raw;
    const key = line.slice(0, eq).trim();
    if (!(key in clean)) return raw;
    handled.add(key);
    return key + '=' + clean[key];
  });

  const added = Object.entries(clean).filter(([k]) => !handled.has(k));
  if (added.length) {
    next.push('', '# Set from the dashboard');
    for (const [k, v] of added) next.push(k + '=' + v);
  }

  const tmp = ENV_PATH + '.tmp';
  writeFileSync(tmp, next.join('\n'), 'utf8');
  renameSync(tmp, ENV_PATH);

  reloadConfig();
  // The provider caches its RPC URL and pins a chain id, so it must be thrown
  // away after a settings change - otherwise a network switch keeps talking to
  // the old chain.
  resetProviders();
}
