/**
 * Distributed lock abstraction used for race-sensitive operations.
 */
export interface LockProvider {
  withLock<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T>;
}

/**
 * Lock provider that executes immediately without acquiring any lock.
 */
export class NoopLockProvider implements LockProvider {
  async withLock<T>(_key: string, _ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
