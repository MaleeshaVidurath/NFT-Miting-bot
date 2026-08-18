import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../../core/config.js';
import { log } from '../../core/logger.js';

export type MintOutcome =
  | 'minted'      // confirmed on-chain
  | 'failed'      // broadcast but reverted or errored
  | 'skipped'     // already minted by this wallet
  | 'rejected'    // failed eligibility
  | 'dry-run';    // simulated only

export interface MintRecord {
  address: string;
  name?: string;
  wallet: string;
  outcome: MintOutcome;
  txHash?: string;
  quantity: number;
  priceWei?: string;
  reason?: string;
  at: string;
}

interface LedgerFile {
  version: 1;
  records: MintRecord[];
}

/**
 * Append-only record of what the bot has done, persisted to disk so a restart
 * does not re-attempt drops this wallet already minted.
 *
 * Keyed by wallet+contract: the same machine may run several burner wallets,
 * and each wallet's mint history is its own.
 */
class Ledger {
  private records: MintRecord[] = [];
  private index = new Set<string>();
  private loaded = false;

  private key(wallet: string, address: string): string {
    return wallet.toLowerCase() + ':' + address.toLowerCase();
  }

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!existsSync(config.ledgerPath)) return;

    try {
      const parsed = JSON.parse(readFileSync(config.ledgerPath, 'utf8')) as LedgerFile;
      this.records = parsed.records ?? [];
      for (const r of this.records) {
        // A real mint, or a confirmed pre-existing holding, blocks a retry.
        // A failure stays retryable.
        if (r.outcome === 'minted' || r.outcome === 'skipped') {
          this.index.add(this.key(r.wallet, r.address));
        }
      }
      log.info('Ledger loaded: ' + this.records.length + ' records, ' + this.index.size + ' completed mints');
    } catch (err) {
      log.error('Ledger unreadable, starting fresh: ' + (err as Error).message);
      this.records = [];
    }
  }

  /** Has this wallet already successfully minted this contract, per our records? */
  hasMinted(wallet: string, address: string): boolean {
    this.load();
    return this.index.has(this.key(wallet, address));
  }

  /** How many times this wallet has already tried and failed on this contract. */
  failedAttempts(wallet: string, address: string): number {
    this.load();
    const k = this.key(wallet, address);
    return this.records.filter(
      (r) => r.outcome === 'failed' && this.key(r.wallet, r.address) === k,
    ).length;
  }

  record(entry: Omit<MintRecord, 'at'>): void {
    this.load();
    const full: MintRecord = { ...entry, at: new Date().toISOString() };
    this.records.push(full);
    if (full.outcome === 'minted' || full.outcome === 'skipped') {
      this.index.add(this.key(full.wallet, full.address));
    }
    this.persist();
  }

  /** Write via temp file + rename so a crash mid-write cannot corrupt the ledger. */
  private persist(): void {
    try {
      const dir = dirname(config.ledgerPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const tmp = config.ledgerPath + '.tmp';
      const body: LedgerFile = { version: 1, records: this.records };
      writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8');
      renameSync(tmp, config.ledgerPath);
    } catch (err) {
      log.error('Ledger write failed: ' + (err as Error).message);
    }
  }

  all(): MintRecord[] {
    this.load();
    return [...this.records];
  }

  get stats() {
    this.load();
    const by = (o: MintOutcome) => this.records.filter((r) => r.outcome === o).length;
    return {
      total: this.records.length,
      minted: by('minted'),
      failed: by('failed'),
      skipped: by('skipped'),
      dryRun: by('dry-run'),
    };
  }
}

export const ledger = new Ledger();
