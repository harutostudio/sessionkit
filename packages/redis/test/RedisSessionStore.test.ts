import { describe, expect, it } from "vitest";
import { RedisSessionStore, type RedisClientLike } from "../src";

type StoredValue = {
  payload: { userId: string };
  createdAt: number;
  expiresAt: number;
};

function createInMemoryRedisClient(): RedisClientLike {
  const map = new Map<string, string>();

  return {
    async get(key: string): Promise<string | null> {
      return map.get(key) ?? null;
    },
    async set(...args: unknown[]): Promise<unknown> {
      const [key, value] = args;
      map.set(String(key), String(value));
      return "OK";
    },
    async setEx(key: string, _ttlSeconds: number, value: string): Promise<unknown> {
      map.set(key, value);
      return "OK";
    },
    async del(key: string): Promise<number> {
      return map.delete(key) ? 1 : 0;
    },
  };
}

describe("RedisSessionStore", () => {
  it("supports set/get/del using an existing redis client instance", async () => {
    const store = new RedisSessionStore<StoredValue["payload"]>(createInMemoryRedisClient());
    const now = Date.now();
    const value: StoredValue = {
      payload: { userId: "u-redis" },
      createdAt: now,
      expiresAt: now + 60_000,
    };

    await store.set("sid-1", value, 60);
    await expect(store.get("sid-1")).resolves.toEqual(value);

    await store.del("sid-1");
    await expect(store.get("sid-1")).resolves.toBeNull();

    await expect(store.close()).resolves.toBeUndefined();
  });
});
