/**
 * Applies the eligibility rules to every drop scheduled on SeaDrop.
 *   npm run drops:eligible -- [blocksBack]
 */
import { getAddress } from 'ethers';
import { getProvider } from '../flow/02-chain/provider.js';
import { config } from '../core/config.js';
import { inspectDrop } from '../flow/03-drops/inspector.js';
import { formatDrop, type DropInfo } from '../flow/03-drops/types.js';
import { PUBLIC_DROP_UPDATED } from '../flow/01-scan/seaDropEvents.js';
import { evaluate, type Eligibility } from '../flow/05-eligibility/rules.js';
import { getEthUsd } from '../flow/04-analyze/price.js';

async function collectTokens(from: number, to: number): Promise<Set<string>> {
  const provider = getProvider();
  const tokens = new Set<string>();
  for (let f = from; f <= to; f += config.logChunkSize) {
    const t = Math.min(f + config.logChunkSize - 1, to);
    const logs = await provider.getLogs({
      address: config.seaDropAddress,
      fromBlock: f,
      toBlock: t,
      topics: [PUBLIC_DROP_UPDATED],
    });
    for (const l of logs) {
      const topic = l.topics[1];
      if (topic) tokens.add(getAddress('0x' + topic.slice(26)));
    }
  }
  return tokens;
}

async function main() {
  const blocksBack = Number(process.argv[2] ?? 15000);
  const provider = getProvider();
  const latest = await provider.getBlockNumber();
  const from = Math.max(0, latest - blocksBack);

  const rate = await getEthUsd();
  console.log('\nEligibility rules: free = always | paid = credibility >= ' +
    config.minCredibility + ' AND <= $' + config.maxPaidMintUsd);
  console.log('ETH/USD = ' + (rate ?? 'unavailable'));
  console.log('Blocks ' + from + '-' + latest + '\n');

  const tokens = await collectTokens(from, latest);
  const rows: { drop: DropInfo; verdict: Eligibility }[] = [];

  for (const t of tokens) {
    try {
      const drop = await inspectDrop(t);
      if (drop.status === 'ended' || drop.status === 'sold-out') continue;
      rows.push({ drop, verdict: await evaluate(drop) });
    } catch {
      /* unreadable, skip */
    }
  }

  const eligible = rows.filter((r) => r.verdict.eligible);
  const rejected = rows.filter((r) => !r.verdict.eligible);

  console.log('=== ELIGIBLE (' + eligible.length + ') ===\n');
  for (const { drop, verdict } of eligible) {
    console.log('  ' + formatDrop(drop));
    console.log('      ' + verdict.branch.toUpperCase() + ': ' + verdict.reason);
    if (verdict.credibility) {
      for (const s of verdict.credibility.signals) {
        if (s.value !== undefined && s.value < 1) console.log('        - ' + s.name + ': ' + s.detail);
      }
    }
  }

  console.log('\n=== REJECTED (' + rejected.length + ') ===\n');
  for (const { drop, verdict } of rejected) {
    console.log('  ' + (drop.name ?? drop.address) + ' [' + drop.status + '] - ' + verdict.reason);
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
