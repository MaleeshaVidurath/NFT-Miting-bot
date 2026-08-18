import { makeClient, type OSCollection, type OpenSeaClient } from './openSeaClient.js';
import { getProvider } from '../02-chain/provider.js';
import { config } from '../../core/config.js';
import { log } from '../../core/logger.js';
import { beat } from '../../core/health.js';
import { parseScanSource, SourceUrlError, type ScanSource } from './sourceUrl.js';
import type { CandidateHandler, Detector } from './types.js';

/**
 * Polls OpenSea and emits each new contract address once, as a candidate.
 *
 * What gets polled comes from the scan source URL, which the dashboard can
 * change: either every collection on a chain, or one named collection.
 *
 * This detector deliberately does NOT judge whether a mint is free - that is
 * the executor's static-call simulation. It only surfaces new arrivals.
 */
export function openSeaCollectionsDetector(): Detector {
  const seen = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let running = false;

  /** Re-read each sweep, so a source change applies without a code change. */
  function currentSource(): ScanSource | undefined {
    try {
      return parseScanSource(config.openSeaUrl);
    } catch (err) {
      if (err instanceof SourceUrlError) log.warn('Scan source unusable: ' + err.message);
      return undefined;
    }
  }

  function contractsFor(col: OSCollection, chain: string): string[] {
    return (col.contracts ?? []).filter((c) => c.chain === chain).map((c) => c.address);
  }

  async function emit(
    collections: OSCollection[],
    chain: string,
    onCandidate: CandidateHandler,
  ): Promise<number> {
    const blockNumber = await getProvider().getBlockNumber();
    let fresh = 0;

    for (const col of collections) {
      for (const contract of contractsFor(col, chain)) {
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
    return fresh;
  }

  async function sweep(onCandidate: CandidateHandler, client: OpenSeaClient): Promise<void> {
    const source = currentSource();
    if (!source) return;

    if (source.kind === 'collection') {
      const col = await client.getCollection(source.slug);
      // A single collection is pinned to whatever chain it lives on, so take
      // the chain from the collection itself rather than assuming.
      const chain = col.contracts?.[0]?.chain ?? config.openSeaChain;
      const fresh = await emit([col], chain, onCandidate);
      log.debug('OpenSea sweep: collection ' + source.slug + ', ' + fresh + ' new contracts');
      return;
    }

    const page = await client.listCollections(source.chain, config.openSeaPageSize);
    const list = page.collections ?? [];
    const fresh = await emit(list, source.chain, onCandidate);
    log.debug('OpenSea sweep: ' + list.length + ' collections on ' + source.chain + ', ' + fresh + ' new');
  }

  return {
    name: 'opensea-collections',

    async start(onCandidate) {
      const client = makeClient();
      if (!client) return;

      const source = currentSource();
      if (source) log.info('OpenSea scan source: ' + source.label);
      running = true;

      const tick = async () => {
        if (!running) return;
        try {
          await sweep(onCandidate, client);
          beat('opensea-collections');
        } catch (err) {
          beat('opensea-collections');
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
