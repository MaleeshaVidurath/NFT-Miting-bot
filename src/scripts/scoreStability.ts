/**
 * Scores the same contracts repeatedly and reports any variation.
 *   npm run check:scores -- <address> [address...]
 *
 * A credibility score must not move when nothing about the project has moved.
 */
import { inspectDrop } from '../flow/03-drops/inspector.js';
import { scoreCredibility } from '../flow/04-analyze/credibility.js';

const ROUNDS = 4;

async function main() {
  const addresses = process.argv.slice(2);
  if (!addresses.length) {
    console.error('  Pass one or more contract addresses.');
    process.exit(1);
  }

  let unstable = 0;

  for (const address of addresses) {
    const drop = await inspectDrop(address);
    const scores: number[] = [];
    const goodScores: number[] = [];

    for (let i = 0; i < ROUNDS; i++) {
      const r = await scoreCredibility(drop);
      scores.push(r.score);
      // Only complete readings are compared. A degraded round is discarded by
      // the eligibility rule anyway, so its score never drives a decision.
      if (!r.degraded) goodScores.push(r.score);
    }

    const degradedRounds = ROUNDS - goodScores.length;
    const steady = goodScores.length === 0 || new Set(goodScores).size === 1;
    if (!steady) unstable += 1;

    const label = goodScores.length === 0 ? 'NO DATA ' : steady ? 'STABLE  ' : 'VARIES  ';
    console.log(
      '  ' + label +
      (drop.name ?? address).slice(0, 24).padEnd(24) +
      ' complete=' + (goodScores.join(',') || 'none') +
      (degradedRounds ? '  (' + degradedRounds + '/' + ROUNDS + ' rounds discarded: explorer unavailable)' : ''),
    );
  }

  console.log();
  if (unstable) {
    console.log('  ' + unstable + ' contract(s) scored inconsistently.\n');
    process.exit(1);
  }
  console.log('  All scores stable across ' + ROUNDS + ' rounds.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
