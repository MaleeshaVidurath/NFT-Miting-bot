/**
 * Turns an OpenSea URL a person pasted into something the API can query.
 *
 * The dashboard lets the user change where drops are scanned from, and people
 * paste whatever is in their address bar - so this accepts the real shapes
 * OpenSea uses rather than demanding one exact format.
 */

export type ScanSource =
  | { kind: 'chain'; chain: string; label: string }
  | { kind: 'collection'; slug: string; label: string };

export class SourceUrlError extends Error {}

const CHAIN_PATHS = [
  /^\/collections?\/chain\/([a-z0-9_-]+)\/?$/i,   // /collections/chain/robinhood
  /^\/chain\/([a-z0-9_-]+)\/?$/i,                 // /chain/robinhood
];

const COLLECTION_PATHS = [
  /^\/collection\/([a-z0-9_-]+)/i,                // /collection/hood-agents
  /^\/collections\/([a-z0-9_-]+)\/?$/i,           // /collections/hood-agents
  /^\/drops?\/([a-z0-9_-]+)/i,                    // /drops/hood-agents
  /^\/assets\/[a-z0-9_-]+\/([a-z0-9_-]+)/i,       // /assets/<chain>/<slug>/...
];

/**
 * Accepts a full OpenSea URL, or a bare chain slug like "robinhood".
 * Throws SourceUrlError with a message meant to be shown to a user.
 */
export function parseScanSource(input: string): ScanSource {
  const raw = (input ?? '').trim();
  if (!raw) throw new SourceUrlError('Enter an OpenSea URL, or a chain name like "robinhood"');

  // Bare slug: "robinhood", "base"
  if (/^[a-z0-9_-]+$/i.test(raw)) {
    return { kind: 'chain', chain: raw.toLowerCase(), label: 'all drops on chain "' + raw.toLowerCase() + '"' };
  }

  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : 'https://' + raw);
  } catch {
    throw new SourceUrlError('That does not look like a web address');
  }

  if (!/(^|\.)opensea\.io$/i.test(url.hostname)) {
    throw new SourceUrlError('Only opensea.io links are supported (got ' + url.hostname + ')');
  }

  const path = url.pathname.replace(/\/+$/, '') || '/';

  for (const re of CHAIN_PATHS) {
    const m = re.exec(path);
    if (m) {
      const chain = m[1]!.toLowerCase();
      return { kind: 'chain', chain, label: 'all drops on chain "' + chain + '"' };
    }
  }

  for (const re of COLLECTION_PATHS) {
    const m = re.exec(path);
    if (m) {
      const slug = m[1]!.toLowerCase();
      return { kind: 'collection', slug, label: 'the single collection "' + slug + '"' };
    }
  }

  // A chain may also arrive as a query param, e.g. ?chains=robinhood
  const q = url.searchParams.get('chains') ?? url.searchParams.get('chain');
  if (q) {
    const chain = q.split(',')[0]!.trim().toLowerCase();
    if (chain) return { kind: 'chain', chain, label: 'all drops on chain "' + chain + '"' };
  }

  throw new SourceUrlError(
    'Could not tell what to scan from that link. Use a chain page like ' +
    'https://opensea.io/collections/chain/robinhood, or a collection page.',
  );
}

/** Never throws - for display where an invalid value should not break the page. */
export function describeSource(input: string): { ok: boolean; label: string; chain?: string; slug?: string } {
  try {
    const s = parseScanSource(input);
    return s.kind === 'chain'
      ? { ok: true, label: s.label, chain: s.chain }
      : { ok: true, label: s.label, slug: s.slug };
  } catch (err) {
    return { ok: false, label: (err as Error).message };
  }
}
