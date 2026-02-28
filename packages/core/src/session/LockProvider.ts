export interface LockProvider {
  withLock<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T>;
}

export class NoopLockProvider implements LockProvider {
  async withLock<T>(_key: string, _ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
