import type { SessionStore, StoredSession } from "@sessionkit/core";
import {
  RedisClientManager,
  type RedisClientLike,
  type RedisConnectionInput,
  type RedisConnectionParams,
  normalizeTtl,
  setWithTtl,
} from "./internal/redisClient";

export type SessionCodec<TPayload> = {
  serialize: (value: StoredSession<TPayload>) => string;
  deserialize: (raw: string) => StoredSession<TPayload>;
};

export type RedisSessionStoreOptions<TPayload> = {
  keyPrefix?: string;
  codec?: SessionCodec<TPayload>;
};

const DEFAULT_KEY_PREFIX = "sessionkit:sess:";

export class RedisSessionStore<TPayload> implements SessionStore<TPayload> {
  private readonly keyPrefix: string;
  private readonly codec: SessionCodec<TPayload>;
  private readonly clientManager: RedisClientManager;

  constructor(connection: RedisConnectionInput, options?: RedisSessionStoreOptions<TPayload>) {
    this.clientManager = new RedisClientManager(connection);
    this.keyPrefix = options?.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.codec = options?.codec ?? createJsonCodec<TPayload>();
  }

  async get(sessionId: string): Promise<StoredSession<TPayload> | null> {
    const client = await this.clientManager.getClient();
    const raw = await client.get(this.makeKey(sessionId));
    if (raw === null) {
      return null;
    }

    try {
      return this.codec.deserialize(raw);
    } catch {
      return null;
    }
  }

  async set(sessionId: string, value: StoredSession<TPayload>, ttlSeconds: number): Promise<void> {
    const ttl = normalizeTtl(ttlSeconds);
    const client = await this.clientManager.getClient();
    const key = this.makeKey(sessionId);
    const raw = this.codec.serialize(value);

    await setWithTtl(client, key, raw, ttl);
  }

  async del(sessionId: string): Promise<void> {
    const client = await this.clientManager.getClient();
    await client.del(this.makeKey(sessionId));
  }

  async touch(sessionId: string, ttlSeconds: number): Promise<void> {
    const ttl = normalizeTtl(ttlSeconds);
    const client = await this.clientManager.getClient();
    const key = this.makeKey(sessionId);

    if (typeof client.expire === "function") {
      await client.expire(key, ttl);
      return;
    }

    const current = await client.get(key);
    if (current === null) {
      return;
    }

    await setWithTtl(client, key, current, ttl);
  }

  async close(): Promise<void> {
    await this.clientManager.close();
  }

  getClientManager(): RedisClientManager {
    return this.clientManager;
  }

  private makeKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }
}

function createJsonCodec<TPayload>(): SessionCodec<TPayload> {
  return {
    serialize(value) {
      return JSON.stringify(value);
    },
    deserialize(raw) {
      return JSON.parse(raw) as StoredSession<TPayload>;
    },
  };
}

export type { RedisClientLike, RedisConnectionInput, RedisConnectionParams };
