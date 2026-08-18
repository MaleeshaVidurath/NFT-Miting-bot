/**
 * Scans recent blocks on-chain for NFT mint activity, then reports the drop
 * schedule the inspector can read for each contract found.
 *   npm run drops:scan -- [blocksBack]
 */
import { getProvider } from '../flow/02-chain/provider.js';
import { inspectDrop } from '../flow/03-drops/inspector.js';
import { formatDrop } from '../flow/03-drops/types.js';
import { config } from '../core/config.js';

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO32 = '0x' + '0'.repeat(64);

async function main() {
  const blocksBack = Number(process.argv[2] ?? 2000);
  const provider = getProvider();
  const latest = await provider.getBlockNumber();
  const from = Math.max(0, latest - blocksBack);

  console.log('\nScanning ' + config.chain + ' blocks ' + from + '-' + latest + ' for NFT mints\n');

  // from == 0x0 means a mint. 4 topics means ERC-721 (indexed tokenId).
  const logs = await provider.getLogs({
    fromBlock: from,
    toBlock: latest,
    topics: [TRANSFER, ZERO32],
  });

  const contracts = new Map<string, number>();
  for (const l of logs) {
    if (l.topics.length !== 4) continue; // skip ERC-20
    const a = l.address.toLowerCase();
    contracts.set(a, (contracts.get(a) ?? 0) + 1);
  }

  if (contracts.size === 0) {
    console.log('No ERC-721 mints in this range. Try a larger window:');
    console.log('  npm run drops:scan -- 20000\n');
    return;
  }

  const ranked = [...contracts.entries()].sort((a, b) => b[1] - a[1]);
  console.log('Found ' + ranked.length + ' contracts minting in this window.\n');

  for (const [address, mints] of ranked.slice(0, 12)) {
    try {
      const info = await inspectDrop(address);
      console.log('  ' + mints + ' mints  ' + formatDrop(info));
    } catch (err) {
      console.log('  ' + mints + ' mints  ' + address + '  inspect failed: ' + (err as Error).message);
    }
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
