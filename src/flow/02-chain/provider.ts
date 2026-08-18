import { JsonRpcProvider, WebSocketProvider, Wallet, type Provider } from 'ethers';
import { config } from '../../core/config.js';
import { log } from '../../core/logger.js';

let httpProvider: JsonRpcProvider | undefined;
let wsProvider: WebSocketProvider | undefined;
let wallet: Wallet | undefined;

/** Request/response provider. Always available. */
export function getProvider(): JsonRpcProvider {
  if (!httpProvider) {
    httpProvider = new JsonRpcProvider(config.rpcHttpUrl, config.chainId, {
      staticNetwork: true,
    });
  }
  return httpProvider;
}

/**
 * Streaming provider for block / pending-tx subscriptions.
 * Returns undefined when RPC_WS_URL is not set - callers fall back to polling.
 */
export function getStreamProvider(): WebSocketProvider | undefined {
  if (!config.rpcWsUrl) return undefined;
  if (!wsProvider) {
    wsProvider = new WebSocketProvider(config.rpcWsUrl, config.chainId, {
      staticNetwork: true,
    });
  }
  return wsProvider;
}

/** Signer for mint txs. Undefined in read-only / no-key setups. */
export function getWallet(): Wallet | undefined {
  if (!config.privateKey) return undefined;
  if (!wallet) wallet = new Wallet(config.privateKey, getProvider());
  return wallet;
}

export async function verifyConnection(): Promise<void> {
  const p: Provider = getProvider();
  const net = await p.getNetwork();
  if (Number(net.chainId) !== config.chainId) {
    throw new Error(
      `RPC chainId ${net.chainId} does not match configured CHAIN=${config.chain} (${config.chainId})`,
    );
  }
  const block = await p.getBlockNumber();
  log.info(`Connected to ${config.chain} (chainId ${config.chainId}) at block ${block}`);

  const w = getWallet();
  if (w) {
    const bal = await p.getBalance(w.address);
    log.info(`Wallet ${w.address} balance ${bal} wei`);
  } else {
    log.warn('No PRIVATE_KEY set - running in observe-only mode');
  }
}

/**
 * Drop cached providers and wallet so the next call rebuilds them from the
 * current config.
 *
 * Without this, switching network in the dashboard would keep talking to the
 * old chain: the provider is cached at module level and pins its chain id.
 */
export function resetProviders(): void {
  try {
    wsProvider?.destroy();
    httpProvider?.destroy();
  } catch {
    /* already gone */
  }
  httpProvider = undefined;
  wsProvider = undefined;
  wallet = undefined;
}

export async function shutdown(): Promise<void> {
  await wsProvider?.destroy();
  httpProvider?.destroy();
}
