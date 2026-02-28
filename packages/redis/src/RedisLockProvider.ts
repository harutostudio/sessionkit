import type { LockProvider } from "@sessionkit/core";
import {
  RedisClientManager,
  type RedisConnectionInput,
  normalizeTtl,
  releaseLockIfOwned,
  setNxWithTtl,
} from "./internal/redisClient";
import type { RedisSessionStore } from "./RedisSessionStore";

export type RedisLockProviderOptions = {
  keyPrefix?: string;
  acquireTimeoutMs?: number;
  retryDelayMs?: number;
};

export type RedisLockProviderInput =
  | RedisConnectionInput
  | {
      store: RedisSessionStore<unknown>;
    };

const DEFAULT_KEY_PREFIX = "sessionkit:lock:";
const DEFAULT_ACQUIRE_TIMEOUT_MS = 5000;
const DEFAULT_RETRY_DELAY_MS = 50;

export class RedisLockProvider implements LockProvider {
  private readonly keyPrefix: string;
  private readonly acquireTimeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly clientManager: RedisClientManager;

  constructor(input: RedisLockProviderInput, options?: RedisLockProviderOptions) {
    this.clientManager = isStoreInput(input) ? input.store.getClientManager() : new RedisClientManager(input);
    this.keyPrefix = options?.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.acquireTimeoutMs = options?.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
    this.retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  async withLock<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const ttl = normalizeTtl(ttlSeconds);
    const lockKey = `${this.keyPrefix}${key}`;
    const token = createLockToken();
    const client = await this.clientManager.getClient();

    const acquired = await this.acquireLock(client, lockKey, token, ttl);
    if (!acquired) {
      throw new Error(`Failed to acquire lock: ${lockKey}`);
    }

    try {
      return await fn();
    } finally {
      await releaseLockIfOwned(client, lockKey, token);
    }
  }

  async close(): Promise<void> {
    await this.clientManager.close();
  }

  private async acquireLock(
    client: Awaited<ReturnType<RedisClientManager["getClient"]>>,
    lockKey: string,
    token: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const deadline = Date.now() + this.acquireTimeoutMs;

    while (Date.now() <= deadline) {
      const ok = await setNxWithTtl(client, lockKey, token, ttlSeconds);
      if (ok) {
        return true;
      }

      await sleep(this.retryDelayMs);
    }

    return false;
  }
}

function isStoreInput(input: RedisLockProviderInput): input is { store: RedisSessionStore<unknown> } {
  return typeof input === "object" && input !== null && "store" in input;
}

function createLockToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
