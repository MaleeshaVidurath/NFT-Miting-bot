import { config } from '../../core/config.js';
import { log } from '../../core/logger.js';

const BASE = 'https://api.opensea.io/api/v2';

export interface OSCollection {
  collection: string;
  name: string;
  description?: string;
  created_date?: string;
  owner?: string;
  contracts?: { address: string; chain: string }[];
  total_supply?: number;
  project_url?: string;
  opensea_url?: string;
}

interface CollectionsPage {
  collections: OSCollection[];
  next?: string;
}

export class OpenSeaError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Thin OpenSea API v2 wrapper.
 * Requires OPENSEA_API_KEY - v2 rejects unauthenticated calls with 401.
 */
export class OpenSeaClient {
  constructor(private readonly apiKey: string) {}

  private async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    const res = await fetch(url, {
      headers: { accept: 'application/json', 'x-api-key': this.apiKey },
    });

    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') ?? 2);
      log.warn(`OpenSea rate limited, backing off ${retry}s`);
      await new Promise((r) => setTimeout(r, retry * 1000));
      return this.get<T>(path, params);
    }
    if (!res.ok) {
      throw new OpenSeaError(res.status, `${res.status} ${res.statusText} on ${url.pathname}`);
    }
    return (await res.json()) as T;
  }

  /** Collections on a chain, newest first. */
  listCollections(chain: string, limit = 50, next?: string): Promise<CollectionsPage> {
    const params: Record<string, string | number> = {
      chain,
      order_by: 'created_date',
      limit,
    };
    if (next) params.next = next;
    return this.get<CollectionsPage>('/collections', params);
  }

  getCollection(slug: string): Promise<OSCollection> {
    return this.get<OSCollection>(`/collections/${encodeURIComponent(slug)}`);
  }
}

export function makeClient(): OpenSeaClient | undefined {
  if (!config.openSeaApiKey) {
    log.warn('OPENSEA_API_KEY not set - OpenSea scanning disabled');
    return undefined;
  }
  return new OpenSeaClient(config.openSeaApiKey);
}
