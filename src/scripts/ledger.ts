/**
 * Prints the mint ledger.
 *   npm run ledger
 */
import { ledger } from '../flow/08-save/ledger.js';
import { config } from '../core/config.js';

const records = ledger.all();
const s = ledger.stats;

console.log('\nLedger: ' + config.ledgerPath);
console.log(
  '  ' + s.total + ' records | ' + s.minted + ' minted | ' + s.failed + ' failed | ' +
  s.skipped + ' skipped | ' + s.dryRun + ' dry-run\n',
);

if (records.length === 0) {
  console.log('  (empty)\n');
} else {
  for (const r of records.slice(-40)) {
    console.log(
      '  ' + r.at.slice(0, 19) + '  ' + r.outcome.padEnd(8) + '  ' +
      (r.name ?? r.address).slice(0, 28).padEnd(28) + '  ' +
      (r.txHash ?? r.reason ?? ''),
    );
  }
  console.log();
}
