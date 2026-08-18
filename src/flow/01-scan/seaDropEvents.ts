import { Contract, id } from 'ethers';
import { getProvider } from '../02-chain/provider.js';
import { config } from '../../core/config.js';
import { log } from '../../core/logger.js';
import type { CandidateHandler, Detector } from './types.js';

/**
 * SeaDrop emits PublicDropUpdated when a creator configures a public mint
 * stage. That happens when the drop is SCHEDULED - normally before minting
 * opens - which makes it the earliest reliable signal for an upcoming drop.
 *
 * Far better than waiting for the first mint, which by definition only ever
 * finds drops that are already live.
 */
export const PUBLIC_DROP_UPDATED = id('PublicDropUpdated(address,(uint80,uint48,uint48,uint16,uint16,bool))');

const EVENT_ABI = [
  'event PublicDropUpdated(address indexed nftContract, tuple(uint80 mintPrice,uint48 startTime,uint48 endTime,uint16 maxTotalMintableByWallet,uint16 feeBps,bool restrictFeeRecipients) publicDrop)',
];

export function seaDropEventDetector(): Detector {
  let cursor = 0;
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  async function sweep(onCandidate: CandidateHandler): Promise<void> {
    const provider = getProvider();
    const latest = await provider.getBlockNumber();
    if (cursor === 0) cursor = Math.max(0, latest - config.seaDropBackfillBlocks);
    if (cursor > latest) return;

    const iface = new Contract(config.seaDropAddress, EVENT_ABI, provider).interface;

    // Chunked so a wide backfill does not trip the RPC's log-range limit.
    for (let from = cursor; from <= latest; from += config.logChunkSize) {
      const to = Math.min(from + config.logChunkSize - 1, latest);
      const logs = await provider.getLogs({
        address: config.seaDropAddress,
        fromBlock: from,
        toBlock: to,
        topics: [PUBLIC_DROP_UPDATED],
      });

      for (const entry of logs) {
        let nftContract: string;
        try {
          const parsed = iface.parseLog({ topics: [...entry.topics], data: entry.data });
          nftContract = parsed?.args?.[0] as string;
        } catch {
          continue;
        }
        if (!nftContract) continue;

        await onCandidate({
          address: nftContract,
          source: 'seadrop-scheduled',
          blockNumber: entry.blockNumber,
          evidence: { tx: entry.transactionHash },
        });
      }
      if (logs.length) log.debug('SeaDrop events ' + from + '-' + to + ': ' + logs.length);
    }
    cursor = latest + 1;
  }

  return {
    name: 'seadrop-events',

    async start(onCandidate) {
      running = true;
      const tick = async () => {
        if (!running) return;
        try {
          await sweep(onCandidate);
        } catch (err) {
          log.error('SeaDrop event sweep failed', (err as Error).message);
        }
        if (running) timer = setTimeout(tick, config.pollIntervalMs);
      };
      await tick();
    },

    async stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}
