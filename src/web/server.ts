import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../core/config.js';
import { log, recentLogs } from '../core/logger.js';
import { bus, type LogLine, type DropEvent, type ResultEvent } from '../core/events.js';
import { hunter } from '../hunter.js';
import { getProvider, getWallet } from '../flow/02-chain/index.js';
import { allDrops } from '../flow/03-drops/registry.js';
import { ledger } from '../flow/08-save/index.js';
import { getEthRate, getEthRateCached, money, currencyOf, conversionFactor } from '../flow/04-analyze/index.js';
import { FIELDS, readSettings, writeSettings, ValidationError } from './settings.js';
import { describeSource } from '../flow/01-scan/sourceUrl.js';

/**
 * The dashboard page.
 *
 * In the single-file build the HTML is embedded in the executable, so there is
 * nothing to install alongside it. Running from source it is read from disk on
 * every request, so edits show on refresh.
 */
interface SeaApi { isSea(): boolean; getAsset(key: string, encoding: string): string }
// Present only in the bundled build; undefined when running from source.
declare const require: ((m: string) => unknown) | undefined;

function readDashboard(): string {
  try {
    if (typeof require === 'function') {
      const sea = require('node:sea') as SeaApi;
      if (sea.isSea()) return sea.getAsset('index.html', 'utf8');
    }
  } catch {
    /* not a packaged build */
  }
  // Running from source. Resolved lazily: import.meta is not available in the
  // bundled build, so touching it at module load would crash the executable.
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, 'public', 'index.html'), 'utf8');
}

function json(res: ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error('Request too large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function status() {
  let block: number | undefined;
  let balanceWei: string | undefined;
  let rpcOk = false;
  try {
    const provider = getProvider();
    block = await provider.getBlockNumber();
    rpcOk = true;
    const wallet = getWallet();
    if (wallet) balanceWei = (await provider.getBalance(wallet.address)).toString();
  } catch {
    rpcOk = false;
  }

  return {
    ...hunter.stats,
    chain: config.chain,
    chainId: config.chainId,
    dryRun: config.dryRun,
    rpcOk,
    block,
    wallet: getWallet()?.address,
    balanceWei,
    ethUsd: getEthRateCached(),
    minCredibility: config.minCredibility,
    maxPaidMintPrice: config.maxPaidMintPrice,
    currency: currencyOf(config.currency),
    maxPaidMintLabel: money(config.maxPaidMintPrice),
    openSeaConfigured: Boolean(config.openSeaApiKey),
    source: { url: config.openSeaUrl, ...describeSource(config.openSeaUrl) },
  };
}

/** Server-Sent Events: one stream carries logs, drops and results. */
function stream(res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');

  const send = (event: string, data: unknown) => {
    res.write('event: ' + event + '\n');
    res.write('data: ' + JSON.stringify(data) + '\n\n');
  };

  const onLog = (l: LogLine) => send('log', l);
  const onDrop = (d: DropEvent) => send('drop', d);
  const onResult = (r: ResultEvent) => send('result', r);
  const onState = (s: { running: boolean }) => send('state', s);

  bus.onTyped('log', onLog);
  bus.onTyped('drop', onDrop);
  bus.onTyped('result', onResult);
  bus.onTyped('state', onState);

  // Proxies and browsers drop an idle stream; a comment keeps it warm.
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);

  res.on('close', () => {
    clearInterval(ping);
    bus.offTyped('log', onLog);
    bus.offTyped('drop', onDrop);
    bus.offTyped('result', onResult);
    bus.offTyped('state', onState);
  });
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (path === '/' || path === '/index.html') {
    const html = readDashboard();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (path === '/api/events') return stream(res);

  if (path === '/api/status') return json(res, 200, await status());

  // Live preview so the user sees what a pasted link means before saving.
  if (path === '/api/source-preview') {
    const value = url.searchParams.get('url') ?? '';
    const parsed = describeSource(value);
    const mismatch = parsed.ok && parsed.chain && parsed.chain !== config.chain
      ? 'This scans OpenSea for "' + parsed.chain + '", but the bot is connected to ' +
        config.chain + '. Mints happen on ' + config.chain + ', so change the network too.'
      : undefined;
    return json(res, 200, { ...parsed, mismatch });
  }
  // What WOULD happen at a given threshold, judged against drops already seen.
  // Lets the user see the consequence of a change before committing to it.
  if (path === '/api/rules-preview') {
    const minCred = Number(url.searchParams.get('minCredibility') ?? config.minCredibility);
    const maxUsd = Number(url.searchParams.get('maxPaidMintPrice') ?? config.maxPaidMintPrice);

    let free = 0, paidPass = 0, failScore = 0, failPrice = 0, unscored = 0;
    for (const d of allDrops()) {
      if (d.status === 'ended' || d.status === 'sold-out') continue;
      if (d.isFree) { free += 1; continue; }
      if (d.priceUsd !== undefined && d.priceUsd > maxUsd) { failPrice += 1; continue; }
      if (d.credibility === undefined) { unscored += 1; continue; }
      if (d.credibility < minCred) { failScore += 1; continue; }
      paidPass += 1;
    }
    return json(res, 200, {
      minCredibility: minCred, maxPaidMintPrice: maxUsd,
      free, paidPass, failScore, failPrice, unscored,
      eligible: free + paidPass,
      considered: free + paidPass + failScore + failPrice + unscored,
    });
  }

  if (path === '/api/currency-preview') {
    const to = (url.searchParams.get('to') ?? config.currency).toLowerCase();
    const factor = await conversionFactor(config.currency, to);
    if (factor === undefined) return json(res, 200, { ok: false, label: 'Exchange rate unavailable' });
    const cur = currencyOf(to);
    const converted = config.maxPaidMintPrice * factor;
    const rounded = cur.decimals === 0 ? Math.round(converted) : Number(converted.toFixed(cur.decimals));
    return json(res, 200, {
      ok: true,
      from: config.currency, to,
      current: money(config.maxPaidMintPrice),
      converted: money(rounded, to),
      changed: to !== config.currency,
    });
  }

  if (path === '/api/rules' && req.method === 'POST') {
    try {
      const body = (await readBody(req)) as Record<string, string>;
      writeSettings({
        MIN_CREDIBILITY: String(body.minCredibility ?? config.minCredibility),
        MAX_PAID_MINT_PRICE: String(body.maxPaidMintPrice ?? config.maxPaidMintPrice),
      });
      log.info('Thresholds updated: credibility >= ' + config.minCredibility +
        ', price <= ' + money(config.maxPaidMintPrice));
      return json(res, 200, {
        ok: true,
        minCredibility: config.minCredibility,
        maxPaidMintPrice: config.maxPaidMintPrice,
      });
    } catch (err) {
      const msg = (err as Error).message;
      return json(res, err instanceof ValidationError ? 400 : 500, { ok: false, error: msg });
    }
  }

  if (path === '/api/drops') return json(res, 200, allDrops());
  if (path === '/api/upcoming') {
    return json(res, 200, hunter.upcoming().map((d) => ({
      address: d.address, name: d.name, startTime: d.startTime,
      isFree: d.isFree, priceWei: d.priceWei?.toString(),
    })));
  }
  if (path === '/api/ledger') return json(res, 200, { stats: ledger.stats, records: ledger.all().slice(-200) });
  if (path === '/api/logs') return json(res, 200, recentLogs());

  if (path === '/api/settings' && req.method === 'GET') {
    return json(res, 200, { fields: FIELDS, values: readSettings() });
  }

  if (path === '/api/settings' && req.method === 'POST') {
    try {
      const body = (await readBody(req)) as Record<string, string>;

      // Switching currency must not silently reinterpret the cap: a limit of
      // "1" meaning one dollar becomes one rupee, which is a very different
      // rule. Restate the number so it keeps the same real value.
      const from = config.currency;
      const to = (body.CURRENCY ?? from).toLowerCase();
      const capUnchanged = body.MAX_PAID_MINT_PRICE === undefined ||
        Number(body.MAX_PAID_MINT_PRICE) === config.maxPaidMintPrice;

      if (to !== from && capUnchanged) {
        const factor = await conversionFactor(from, to);
        if (factor === undefined) {
          return json(res, 400, {
            ok: false,
            error: 'Could not fetch an exchange rate right now, so the price limit ' +
              'cannot be converted safely. Try again in a moment.',
          });
        }
        const cur = currencyOf(to);
        const converted = config.maxPaidMintPrice * factor;
        body.MAX_PAID_MINT_PRICE = String(
          cur.decimals === 0 ? Math.round(converted) : Number(converted.toFixed(cur.decimals)),
        );
        log.info('Currency ' + from.toUpperCase() + ' -> ' + to.toUpperCase() +
          ': price cap restated as ' + body.MAX_PAID_MINT_PRICE);
      }

      writeSettings(body);
      log.info('Settings updated from dashboard');
      return json(res, 200, { ok: true, values: readSettings() });
    } catch (err) {
      const msg = (err as Error).message;
      return json(res, err instanceof ValidationError ? 400 : 500, { ok: false, error: msg });
    }
  }

  if (path === '/api/start' && req.method === 'POST') {
    if (hunter.running) return json(res, 200, { ok: true, already: true });
    // Start in the background: connecting and backfilling takes a while, and
    // the button should not hang waiting for it.
    hunter.start().catch((err) => log.error('Start failed', (err as Error).message));
    return json(res, 200, { ok: true });
  }

  if (path === '/api/stop' && req.method === 'POST') {
    await hunter.stop('Stop button on dashboard');
    return json(res, 200, { ok: true });
  }

  // Shut the whole process down from the dashboard. Needed when the app runs
  // with its console window hidden, where there is no window to close.
  if (path === '/api/quit' && req.method === 'POST') {
    json(res, 200, { ok: true });
    log.info('Quit requested from dashboard');
    setTimeout(() => {
      void hunter.shutdown('Quit button on dashboard').finally(() => process.exit(0));
    }, 250); // let the response reach the browser first
    return;
  }

  json(res, 404, { error: 'not found' });
}

export function startWebServer(): Promise<void> {
  const server = createServer((req, res) => {
    route(req, res).catch((err) => {
      log.error('Request failed', (err as Error).message);
      if (!res.headersSent) json(res, 500, { error: (err as Error).message });
    });
  });

  const url = 'http://' + config.webHost + ':' + config.webPort;

  return new Promise((resolve, reject) => {
    // An unhandled error here closes the window before anyone can read the
    // stack trace, and "already in use" nearly always means it is open already.
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log('\n  The hunter is already running.\n');
        console.log('  Open this in your browser:  ' + url + '\n');
        console.log('  For a second copy, set WEB_PORT to a different number.\n');
        reject(new AlreadyRunning(url));
        return;
      }
      if (err.code === 'EACCES') {
        console.log('\n  Not allowed to use port ' + config.webPort + '.');
        console.log('  Set WEB_PORT to a number above 1024 and try again.\n');
      } else {
        console.log('\n  Could not start the dashboard: ' + err.message + '\n');
      }
      reject(err);
    });

    server.listen(config.webPort, config.webHost, () => {
      console.log('\n  Dashboard ready:  ' + url + '\n');
      log.info('Dashboard listening on ' + url);
      resolve();
    });
  });
}

/** Thrown when another copy already holds the port. */
export class AlreadyRunning extends Error {
  constructor(readonly url: string) {
    super('already running at ' + url);
  }
}
