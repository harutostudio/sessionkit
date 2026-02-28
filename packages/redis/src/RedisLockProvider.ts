import { SessionKitError, type LockProvider } from "@sessionkit/core";
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
  private readonly ownsClientManager: boolean;

  constructor(input: RedisLockProviderInput, options?: RedisLockProviderOptions) {
    if (isStoreInput(input)) {
      this.clientManager = input.store.getClientManager();
      this.ownsClientManager = false;
    } else {
      this.clientManager = new RedisClientManager(input);
      this.ownsClientManager = true;
    }
    this.keyPrefix = options?.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.acquireTimeoutMs = options?.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
    this.retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  async withLock<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const ttl = normalizeTtl(ttlSeconds);
    const lockKey = `${this.keyPrefix}${key}`;
    const token = createLockToken();
    let client: Awaited<ReturnType<RedisClientManager["getClient"]>>;
    try {
      client = await this.clientManager.getClient();
    } catch (error) {
      throw toRedisLockError(error, lockKey, "connect");
    }

    let acquired: boolean;
    try {
      acquired = await this.acquireLock(client, lockKey, token, ttl);
    } catch (error) {
      throw toRedisLockError(error, lockKey, "acquire");
    }

    if (!acquired) {
      throw new SessionKitError("LOCK_TIMEOUT", "Failed to acquire lock within timeout.", undefined, {
        lockKey,
        ttlSeconds: ttl,
        acquireTimeoutMs: this.acquireTimeoutMs,
      });
    }

    let fnError: unknown = null;
    try {
      return await fn();
    } catch (error) {
      fnError = error;
      throw error;
    } finally {
      try {
        await releaseLockIfOwned(client, lockKey, token);
      } catch (error) {
        if (!fnError) {
          throw toRedisLockError(error, lockKey, "release");
        }
      }
    }
  }

  async close(): Promise<void> {
    if (!this.ownsClientManager) {
      return;
    }
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

function toRedisLockError(
  error: unknown,
  lockKey: string,
  phase: "connect" | "acquire" | "release",
): SessionKitError {
  const code = classifyRedisError(error);
  return new SessionKitError(
    code,
    code === "STORE_UNAVAILABLE" ? "Session store is unavailable." : "Redis lock operation failed.",
    error,
    {
      lockKey,
      phase,
      redisCode: getErrorCode(error),
    },
  );
}

function classifyRedisError(error: unknown): "STORE_UNAVAILABLE" | "INTERNAL_ERROR" {
  const msg = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
  const code = getErrorCode(error);

  const storeCodes = new Set([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "NR_CLOSED",
  ]);

  if (storeCodes.has(code)) {
    return "STORE_UNAVAILABLE";
  }

  const storeKeywords = [
    "connect",
    "connection",
    "socket",
    "closed",
    "timeout",
    "read only",
    "loading",
    "clusterdown",
    "try again",
    "no connection",
    "the client is closed",
  ];

  if (storeKeywords.some((k) => msg.includes(k))) {
    return "STORE_UNAVAILABLE";
  }

  return "INTERNAL_ERROR";
}

function getErrorCode(error: unknown): string {
  return String((error as { code?: unknown })?.code ?? "").toUpperCase();
}
