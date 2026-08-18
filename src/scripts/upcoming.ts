/**
 * Reports drops scheduled on SeaDrop, grouped by status.
 *   npm run drops:upcoming -- [blocksBack]
 */
import { getProvider } from '../flow/02-chain/provider.js';
import { config } from '../core/config.js';
import { inspectDrop } from '../flow/03-drops/inspector.js';
import { formatDrop, secondsUntil, type DropInfo } from '../flow/03-drops/types.js';
import { PUBLIC_DROP_UPDATED } from '../flow/01-scan/seaDropEvents.js';
import { getAddress } from 'ethers';

async function main() {
  const blocksBack = Number(process.argv[2] ?? 20000);
  const provider = getProvider();
  const latest = await provider.getBlockNumber();
  const from = Math.max(0, latest - blocksBack);

  console.log('\nSeaDrop schedules configured in blocks ' + from + '-' + latest + '\n');

  const tokens = new Set<string>();
  for (let f = from; f <= latest; f += config.logChunkSize) {
    const t = Math.min(f + config.logChunkSize - 1, latest);
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

  console.log('Found ' + tokens.size + ' tokens with a configured public drop.\n');

  const drops: DropInfo[] = [];
  for (const t of tokens) {
    try {
      drops.push(await inspectDrop(t));
    } catch {
      /* unreadable, skip */
    }
  }

  const show = (title: string, list: DropInfo[]) => {
    if (!list.length) return;
    console.log(title + ' (' + list.length + ')');
    for (const d of list) console.log('  ' + formatDrop(d));
    console.log();
  };

  const upcoming = drops
    .filter((d) => d.status === 'upcoming')
    .sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));

  show('UPCOMING - FREE', upcoming.filter((d) => d.isFree));
  show('UPCOMING - paid', upcoming.filter((d) => !d.isFree));
  show('LIVE NOW - FREE', drops.filter((d) => d.status === 'live' && d.isFree));

  const soon = upcoming.filter((d) => d.isFree && d.startTime && secondsUntil(d.startTime) < 3600);
  if (soon.length) {
    console.log('*** ' + soon.length + ' free drop(s) opening within the hour ***\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
