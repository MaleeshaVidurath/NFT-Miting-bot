import { config } from '../../core/config.js';
import { log } from '../../core/logger.js';

/**
 * Run-scoped spend and rate limits. Every mint attempt must pass through
 * check() first and report its actual cost via record() afterwards.
 */
class Guard {
  private gasSpentWei = 0n;
  private mintsThisRun = 0;
  private mintsByContract = new Map<string, number>();
  private halted = false;

  check(address: string, valueWei: bigint, gasPriceWei: bigint, estGasLimit: bigint): string | null {
    const key = address.toLowerCase();

    if (this.halted) return 'bot halted';
    if (valueWei > config.maxMintValueWei) {
      return `mint value ${valueWei} exceeds MAX_MINT_VALUE_ETH`;
    }
    if (gasPriceWei > config.maxGasPriceWei) {
      return `gas price ${gasPriceWei} exceeds MAX_GAS_GWEI`;
    }
    if (this.mintsThisRun >= config.maxMintsPerRun) {
      return 'MAX_MINTS_PER_RUN reached';
    }
    if ((this.mintsByContract.get(key) ?? 0) >= config.maxMintsPerContract) {
      return 'MAX_MINTS_PER_CONTRACT reached for this contract';
    }

    const projected = this.gasSpentWei + gasPriceWei * estGasLimit;
    if (projected > config.dailyGasBudgetWei) {
      return 'DAILY_GAS_BUDGET_ETH would be exceeded';
    }
    return null;
  }

  record(address: string, gasCostWei: bigint): void {
    const key = address.toLowerCase();
    this.gasSpentWei += gasCostWei;
    this.mintsThisRun += 1;
    this.mintsByContract.set(key, (this.mintsByContract.get(key) ?? 0) + 1);

    if (this.gasSpentWei >= config.dailyGasBudgetWei) {
      this.halted = true;
      log.warn(`Gas budget exhausted (${this.gasSpentWei} wei) - halting further mints`);
    }
  }

  get stats() {
    return { gasSpentWei: this.gasSpentWei, mintsThisRun: this.mintsThisRun, halted: this.halted };
  }
}

export const guard = new Guard();
