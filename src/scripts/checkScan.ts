/**
 * One-shot diagnostic: makes a single OpenSea call and reports exactly what
 * came back, so you can confirm the scanner works before running it live.
 *   npm run scan:check
 */
import { config } from '../core/config.js';
import { makeClient } from '../flow/01-scan/openSeaClient.js';
import { getProvider } from '../flow/02-chain/provider.js';

function fail(msg: string): never {
  console.error(`\n  FAIL  ${msg}\n`);
  process.exit(1);
}

const check = (ok: boolean, label: string, detail = '') =>
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);

async function main() {
  console.log(`\nScanner diagnostic - chain=${config.chain} openSeaChain=${config.openSeaChain}\n`);

  const net = await getProvider().getNetwork();
  check(Number(net.chainId) === config.chainId, 'RPC reachable', `chainId ${net.chainId}`);

  const client = makeClient();
  if (!client) fail('OPENSEA_API_KEY is not set - add it to .env, then rerun');

  const page = await client.listCollections(config.openSeaChain, 20);
  const cols = page.collections ?? [];
  check(cols.length > 0, 'OpenSea returned collections', `${cols.length} on this page`);
  if (cols.length === 0) fail(`No collections for chain slug "${config.openSeaChain}"`);

  // Every collection must actually carry a contract on our chain, or the
  // detector silently drops it.
  const withContract = cols.filter((c) =>
    (c.contracts ?? []).some((x) => x.chain === config.openSeaChain),
  );
  check(
    withContract.length > 0,
    'Collections carry contracts on this chain',
    `${withContract.length}/${cols.length}`,
  );

  // Ordering matters: if created_date comes back ascending we are reading the
  // OLDEST collections every sweep and would never see a new drop.
  const dates = cols.map((c) => c.created_date).filter(Boolean) as string[];
  if (dates.length >= 2) {
    const first = new Date(dates[0]!).getTime();
    const last = new Date(dates[dates.length - 1]!).getTime();
    const desc = first >= last;
    check(desc, 'Newest-first ordering', desc ? 'descending, correct' : 'ASCENDING - scanner would miss new drops');
    console.log(`        newest on page: ${dates[0]}`);
    console.log(`        oldest on page: ${dates[dates.length - 1]}`);
  } else {
    check(false, 'created_date present', 'cannot verify ordering');
  }

  check(Boolean(page.next), 'Pagination cursor returned', page.next ? 'yes' : 'no - single page only');

  console.log('\nSample of what the detector would emit:\n');
  for (const c of withContract.slice(0, 5)) {
    const addr = (c.contracts ?? []).find((x) => x.chain === config.openSeaChain)?.address;
    console.log(`  ${addr}  ${c.name}  (created ${c.created_date ?? 'unknown'})`);
  }
  console.log();
}

main().catch((err) => fail(err.message));
