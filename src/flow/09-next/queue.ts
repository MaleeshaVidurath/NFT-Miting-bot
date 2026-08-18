import { log } from '../../core/logger.js';

/**
 * Runs tasks strictly one at a time - the "move to next" step.
 *
 * Mints must not overlap: two sendTransaction calls from the same wallet in
 * flight together will grab the same nonce, and one of them is dropped.
 * Serialising also keeps the guard's spend accounting honest, since each
 * mint's cost is recorded before the next is checked.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private depth = 0;

  get pending(): number {
    return this.depth;
  }

  push<T>(label: string, task: () => Promise<T>): Promise<T | undefined> {
    this.depth += 1;
    const run = this.tail.then(async () => {
      try {
        return await task();
      } catch (err) {
        log.error('Queued task failed (' + label + ')', (err as Error).message);
        return undefined;
      } finally {
        this.depth -= 1;
      }
    });
    // Keep the chain alive even if a task rejects.
    this.tail = run.catch(() => undefined);
    return run;
  }
}
