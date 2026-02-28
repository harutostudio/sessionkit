export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<number | unknown>;
  expire?(key: string, ttlSeconds: number): Promise<number | unknown>;
  setEx?(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  setex?(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  eval?(...args: unknown[]): Promise<unknown>;
  connect?(): Promise<void>;
  quit?(): Promise<void>;
  disconnect?(): Promise<void>;
  isOpen?: boolean;
  status?: string;
}

export type RedisConnectionParams = {
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: number;
  tls?: boolean;
  lazyConnect?: boolean;
  redisOptions?: Record<string, unknown>;
};

export type RedisClientWrapper = {
  client: RedisClientLike;
  manageClient?: boolean;
  lazyConnect?: boolean;
};

export type RedisConnectionInput = RedisClientLike | RedisClientWrapper | RedisConnectionParams;

export class RedisClientManager {
  private readonly ownClient: boolean;
  private readonly connectionInput: RedisConnectionInput;
  private client: RedisClientLike | null = null;
  private clientInitPromise: Promise<RedisClientLike> | null = null;

  constructor(connection: RedisConnectionInput) {
    this.connectionInput = connection;

    if (isRedisClientLike(connection)) {
      this.ownClient = false;
      this.client = connection;
      return;
    }

    if (isClientWrapper(connection)) {
      this.ownClient = connection.manageClient ?? false;
      this.client = connection.client;
      return;
    }

    this.ownClient = true;
  }

  async getClient(): Promise<RedisClientLike> {
    if (this.client) {
      await ensureConnected(this.client, this.connectionInput);
      return this.client;
    }

    if (!this.clientInitPromise) {
      this.clientInitPromise = this.createOwnedClient();
    }

    this.client = await this.clientInitPromise;
    return this.client;
  }

  async close(): Promise<void> {
    if (!this.ownClient) {
      return;
    }

    const client = await this.getClient();
    if (typeof client.quit === "function") {
      await client.quit();
      return;
    }

    if (typeof client.disconnect === "function") {
      await client.disconnect();
    }
  }

  private async createOwnedClient(): Promise<RedisClientLike> {
    const connection = this.connectionInput;
    if (isRedisClientLike(connection)) {
      await ensureConnected(connection, connection);
      return connection;
    }

    if (isClientWrapper(connection)) {
      await ensureConnected(connection.client, connection);
      return connection.client;
    }

    const redisModule = await import("redis");
    const createClientFn = (
      redisModule as unknown as { createClient?: (options?: Record<string, unknown>) => RedisClientLike }
    ).createClient;

    if (!createClientFn) {
      throw new Error("redis.createClient is not available. Ensure 'redis' package is installed.");
    }

    const options = buildNodeRedisOptions(connection);
    const client = createClientFn(options);
    await ensureConnected(client, connection);
    return client;
  }
}

export function normalizeTtl(ttlSeconds: number): number {
  const ttl = Math.floor(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error("ttlSeconds must be a positive integer.");
  }
  return ttl;
}

export async function setWithTtl(
  client: RedisClientLike,
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  if (typeof client.setEx === "function") {
    await client.setEx(key, ttlSeconds, value);
    return;
  }

  if (typeof client.setex === "function") {
    await client.setex(key, ttlSeconds, value);
    return;
  }

  try {
    await client.set(key, value, { EX: ttlSeconds });
    return;
  } catch {
    await client.set(key, value, "EX", ttlSeconds);
  }
}

export async function setNxWithTtl(
  client: RedisClientLike,
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<boolean> {
  try {
    const result = await client.set(key, value, { NX: true, EX: ttlSeconds });
    return result === "OK" || result === true;
  } catch {
    const result = await client.set(key, value, "NX", "EX", ttlSeconds);
    return result === "OK" || result === true;
  }
}

export async function releaseLockIfOwned(
  client: RedisClientLike,
  key: string,
  token: string,
): Promise<void> {
  const script = [
    "if redis.call('get', KEYS[1]) == ARGV[1] then",
    "  return redis.call('del', KEYS[1])",
    "else",
    "  return 0",
    "end",
  ].join("\n");

  if (typeof client.eval === "function") {
    try {
      await client.eval(script, { keys: [key], arguments: [token] });
      return;
    } catch {
      await client.eval(script, 1, key, token);
      return;
    }
  }

  const current = await client.get(key);
  if (current === token) {
    await client.del(key);
  }
}

export function isRedisClientLike(value: unknown): value is RedisClientLike {
  if (!value || typeof value !== "object") {
    return false;
  }

  const target = value as Partial<RedisClientLike>;
  return typeof target.get === "function" && typeof target.set === "function" && typeof target.del === "function";
}

export function isClientWrapper(value: unknown): value is RedisClientWrapper {
  if (!value || typeof value !== "object") {
    return false;
  }

  const target = value as { client?: unknown };
  return isRedisClientLike(target.client);
}

function buildNodeRedisOptions(connection: RedisConnectionParams): Record<string, unknown> {
  const socket: Record<string, unknown> = {};

  if (connection.host) {
    socket.host = connection.host;
  }

  if (connection.port !== undefined) {
    socket.port = connection.port;
  }

  if (connection.tls) {
    socket.tls = true;
  }

  const options: Record<string, unknown> = {
    ...(connection.redisOptions ?? {}),
  };

  if (connection.url) {
    options.url = connection.url;
  }

  if (Object.keys(socket).length > 0) {
    options.socket = {
      ...(typeof options.socket === "object" && options.socket ? (options.socket as Record<string, unknown>) : {}),
      ...socket,
    };
  }

  if (connection.username) {
    options.username = connection.username;
  }

  if (connection.password) {
    options.password = connection.password;
  }

  if (connection.database !== undefined) {
    options.database = connection.database;
  }

  return options;
}

async function ensureConnected(client: RedisClientLike, input: RedisConnectionInput): Promise<void> {
  if (isClientReady(client)) {
    return;
  }

  const lazyConnect = isClientWrapper(input)
    ? (input.lazyConnect ?? false)
    : isRedisClientLike(input)
      ? false
      : (input.lazyConnect ?? false);

  if (lazyConnect) {
    return;
  }

  if (typeof client.connect === "function") {
    await client.connect();
  }
}

function isClientReady(client: RedisClientLike): boolean {
  if (client.isOpen === true) {
    return true;
  }

  if (typeof client.status === "string") {
    return client.status === "ready" || client.status === "connect" || client.status === "connecting";
  }

  return false;
}
