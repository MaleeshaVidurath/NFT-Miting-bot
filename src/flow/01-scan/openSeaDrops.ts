import { makeClient, type OSCollection } from './openSeaClient.js';
import { getProvider } from '../02-chain/provider.js';
import { config } from '../../core/config.js';
import { log } from '../../core/logger.js';
import type { CandidateHandler, Detector } from './types.js';

/**
 * Polls OpenSea for newly created collections on the configured chain and
 * emits each contract address once, as a candidate.
 *
 * This detector deliberately does NOT judge whether a mint is free - that is
 * the executor's static-call simulation. It only surfaces new arrivals.
 */
export function openSeaCollectionsDetector(): Detector {
  const seen = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  async function sweep(onCandidate: CandidateHandler, client: NonNullable<ReturnType<typeof makeClient>>) {
    const page = await client.listCollections(config.openSeaChain, config.openSeaPageSize);
    const blockNumber = await getProvider().getBlockNumber();
    let fresh = 0;

    for (const col of page.collections ?? []) {
      for (const contract of contractsOnChain(col)) {
        const key = contract.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        fresh += 1;
        await onCandidate({
          address: contract,
          source: 'opensea-collections',
          blockNumber,
          evidence: {
            slug: col.collection,
            name: col.name,
            created: col.created_date,
            totalSupply: col.total_supply,
            url: col.opensea_url,
          },
        });
      }
    }
    log.debug(`OpenSea sweep: ${page.collections?.length ?? 0} collections, ${fresh} new contracts`);
  }

  function contractsOnChain(col: OSCollection): string[] {
    return (col.contracts ?? [])
      .filter((c) => c.chain === config.openSeaChain)
      .map((c) => c.address);
  }

  return {
    name: 'opensea-collections',

    async start(onCandidate) {
      const client = makeClient();
      if (!client) return;
      running = true;

      const tick = async () => {
        if (!running) return;
        try {
          await sweep(onCandidate, client);
        } catch (err) {
          log.error('OpenSea sweep failed', (err as Error).message);
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
