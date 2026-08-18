import { EventEmitter } from 'node:events';

export interface LogLine {
  at: string;
  level: string;
  msg: string;
}

export interface DropEvent {
  address: string;
  name?: string;
  status: string;
  standard: string;
  isFree: boolean;
  priceWei?: string;
  priceUsd?: number;
  startTime?: number;
  endTime?: number;
  maxSupply?: string;
  totalMinted?: string;
  credibility?: number;
  eligible?: boolean;
  reason?: string;
  seenAt: string;
}

export interface ResultEvent {
  address: string;
  name?: string;
  outcome: string;
  txHash?: string;
  reason?: string;
}

interface Events {
  log: [LogLine];
  drop: [DropEvent];
  result: [ResultEvent];
  state: [{ running: boolean }];
}

/**
 * Decouples the dashboard from the flow.
 *
 * The pipeline publishes here; the web layer subscribes. Without this, the UI
 * would have to import flow internals, and the flow would have to know a UI
 * exists.
 */
class Bus extends EventEmitter {
  emitTyped<K extends keyof Events>(event: K, ...args: Events[K]): void {
    this.emit(event, ...args);
  }

  onTyped<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void): void {
    this.on(event, fn as (...a: unknown[]) => void);
  }

  offTyped<K extends keyof Events>(event: K, fn: (...args: Events[K]) => void): void {
    this.off(event, fn as (...a: unknown[]) => void);
  }
}

export const bus = new Bus();
// The dashboard may hold several SSE clients plus internal listeners.
bus.setMaxListeners(50);
