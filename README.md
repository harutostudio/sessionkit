# SessionKit

SessionKit is a framework-agnostic, class-based cookie session engine for Node.js.

This README is the primary documentation for the open-source project.
TypeDoc is kept as a backup API index.

## What is SessionKit

SessionKit separates session runtime logic from framework adapter logic:

- `@sessionkit/core`: session lifecycle, auth state, error model, pluggable store/lock contracts
- `@sessionkit/express`: Express adapter
- `@sessionkit/hono`: Hono adapter
- `@sessionkit/redis`: Redis session store and distributed lock provider

## Key Features

- Framework-neutral core API (no Express/Hono coupling in core)
- Type-safe `payload -> principal` projection
- Complete auth flow: `signIn`, `signOut`, `optionalAuth`, `requireAuth`
- Rolling session support with TTL renewal controls
- Token refresh support with distributed locking
- Unified typed error model via `SessionKitError`

## SessionKit offers

- Clear boundaries between domain auth logic and HTTP runtime integration
- A single request auth context read path via `getAuth`
- Replaceable persistence layer (in-memory, Redis, custom implementation)
- Consistent adapter error-to-HTTP behavior

## Installation

Install only the packages you need:

```bash
# core only
npm install @sessionkit/core

# express integration
npm install @sessionkit/core @sessionkit/express express

# hono integration
npm install @sessionkit/core @sessionkit/hono hono

# redis persistence
npm install @sessionkit/core @sessionkit/redis redis
```

## Example Usage

This example demonstrates:

- global session middleware
- login via `signIn`
- protected route via `requireAuth`
- logout via `signOut`

```ts
import express from "express";
import { MapSessionStore, SessionKit } from "@sessionkit/core";
import { createExpressHttpContext, toExpressMiddleware } from "@sessionkit/express";

type SessionPayload = {
  userId: string;
  role: "user" | "admin";
};

type Principal = {
  id: string;
  role: "user" | "admin";
};

const sessionKit = new SessionKit<SessionPayload, Principal>({
  store: new MapSessionStore<SessionPayload>({
    cleanupIntervalSeconds: 60,
    maxSize: 10000,
  }),
  cookie: {
    name: "sid",
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  },
  session: {
    ttlSeconds: 60 * 60 * 24,
    rolling: true,
    renewBeforeSeconds: 60,
  },
  principalFactory(payload) {
    return { id: payload.userId, role: payload.role };
  },
  hooks: {
    onUnauthorized(ctx) {
      ctx.status(401);
      ctx.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } });
    },
  },
});

const app = express();
app.use(express.json());

// 1) Hydrate auth context for every request.
app.use(toExpressMiddleware(sessionKit.middleware()));

// 2) Login endpoint.
app.post("/login", async (req, res, next) => {
  try {
    const ctx = createExpressHttpContext(req, res);
    const result = await sessionKit.signIn(
      ctx,
      { userId: "u_001", role: "user" },
      { ttlSeconds: 3600, hydrateContext: true },
    );
    res.json({ ok: true, sessionId: result.sessionId, expiresAt: result.expiresAt });
  } catch (error) {
    next(error);
  }
});

// 3) Protected endpoint.
app.get(
  "/me",
  toExpressMiddleware(sessionKit.requireAuth()),
  (req, res) => {
    res.json({ auth: req.auth });
  },
);

// 4) Logout endpoint.
app.post("/logout", async (req, res, next) => {
  try {
    const ctx = createExpressHttpContext(req, res);
    await sessionKit.signOut(ctx, { alwaysClearCookie: true });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.listen(3000);
```

## Public API (Complete)

The list below documents all public exports from package entry points.

### `@sessionkit/core`

#### Class: `SessionKit<TPayload, TPrincipal>`

1. `constructor(opts: SessionKitOptions<TPayload, TPrincipal>)`

- Creates a SessionKit runtime instance.

2. `middleware(): HttpMiddleware`

- Resolves cookie session state and writes auth context to `ctx.setAuth(...)`.

3. `optionalAuth(): HttpMiddleware`

- Semantic alias of `middleware()`.

4. `requireAuth(options?: RequireAuthOptions): HttpMiddleware`

- Requires an authenticated session.
- If not authenticated, behavior priority is:
  - `options.onFail`
  - `opts.hooks.onUnauthorized`
  - otherwise throw `SessionKitError("UNAUTHORIZED", ...)`

5. `signIn(ctx, payload, options?): Promise<SignInResult<TPrincipal>>`

- Creates a new session, persists it in the store, and sets the cookie.
- Returns `{ sessionId, principal, expiresAt }`.

`SignInOptions` optional fields:
- `ttlSeconds?: number`
  - Overrides global `session.ttlSeconds` for this sign-in call.
- `hydrateContext?: boolean` (default: `true`)
  - Controls whether auth context is immediately written for the current request.

6. `signOut(ctx, options?): Promise<void>`

- Deletes session data, clears the cookie, and sets current auth context to unauthenticated.

`SignOutOptions` optional fields:
- `alwaysClearCookie?: boolean` (default: `true`)
  - `true`: clear cookie even if store delete fails.
  - `false`: throw on store delete failure (`STORE_UNAVAILABLE`).

7. `getAuth(ctx): AuthContext<TPayload, TPrincipal>`

- Reads auth context from request context.
- Returns a default unauthenticated object if no auth context is present.

#### Type: `SessionKitOptions<TPayload, TPrincipal>`

Required fields:
- `store: SessionStore<TPayload>`
- `session: { ttlSeconds: number; ... }`
- `principalFactory(payload): TPrincipal`

Optional fields:
- `cookie?: CookieOptions`
- `payloadTransformer?: (raw: unknown) => TPayload`
- `token?: { shouldRefresh; refresh; onRefreshFail? }`
- `lockProvider?: LockProvider`
- `hooks?: { onUnauthorized?; onInvalidSession? }`
- `logger?: Logger`

`session` fields:
- `ttlSeconds: number`
- `rolling?: boolean` (default: `false`)
- `touchEverySeconds?: number` (default: `60`)
- `renewBeforeSeconds?: number` (default: use this field if set, else `touchEverySeconds`, else `60`)

`token` fields:
- `shouldRefresh(payload, nowMs): boolean`
- `refresh(payload): Promise<{ payload; ttlSeconds?: number }>`
- `onRefreshFail?: "unauth" | "revoke"` (default: `"unauth"`)

`hooks` fields:
- `onUnauthorized?(ctx)`
- `onInvalidSession?(ctx, reason)`

#### Type: `CookieOptions`

All fields are optional:
- `name?: string` (default: `"sid"`)
- `path?: string` (default: `"/"`)
- `domain?: string`
- `httpOnly?: boolean` (default: `true`)
- `secure?: boolean`
- `sameSite?: "lax" | "strict" | "none"` (default: `"lax"`)
- `maxAgeSeconds?: number`

#### Interface: `HttpContext`

- `getCookie(name): string | null`
- `setCookie(name, value, options): void`
- `clearCookie(name, options): void`
- `setAuth<T>(value): void`
- `getAuth<T>(): T | null`
- `status(code): void`
- `json(body): void`

#### Type: `HttpMiddleware`

- `(ctx: HttpContext, next: () => Promise<void>) => Promise<void>`

#### Store API

`StoredSession<TPayload>`
- `payload: TPayload`
- `createdAt: number`
- `expiresAt: number`

`SessionStore<TPayload>`
- `get(sessionId): Promise<StoredSession<TPayload> | null>`
- `set(sessionId, value, ttlSeconds): Promise<void>`
- `del(sessionId): Promise<void>`
- `touch?(sessionId, ttlSeconds): Promise<void>` (optional)
- `close?(): Promise<void>` (optional)

`MapSessionStore<TPayload>`
- `constructor(options?)`
  - `cleanupIntervalSeconds?: number` (default: `60`)
  - `maxSize?: number`
- Implements all `SessionStore` methods.

#### Lock API

`LockProvider`
- `withLock<T>(key, ttlSeconds, fn): Promise<T>`

`NoopLockProvider`
- Executes `fn` immediately without a distributed lock.

#### Error API

`ErrorCode`
- `"UNAUTHORIZED"`
- `"INVALID_SESSION"`
- `"SESSION_EXPIRED"`
- `"TOKEN_REFRESH_FAILED"`
- `"LOCK_TIMEOUT"`
- `"STORE_UNAVAILABLE"`
- `"INTERNAL_ERROR"`

`SessionKitError`
- `new SessionKitError(code, message, cause?, details?)`

`ErrorBody`
- `{ error: { code, message } }`

`Logger`
- `debug/info/warn/error(msg, meta?)`

Helpers:
- `defaultErrorBody(code, message): ErrorBody`
- `isSessionKitError(error): error is SessionKitError`
- `toSessionKitError(error): SessionKitError`
- `statusFromErrorCode(code): number`

Cookie helpers:
- `parseCookieHeader(cookieHeader): Record<string, string>`
- `serializeSetCookie(name, value, options): string`
- `serializeClearCookie(name, options): string`

---

### `@sessionkit/express`

#### Types

`SessionKitExpressRequest`
- `headers: Record<string, string | string[] | undefined>`
- `auth?: unknown`

`SessionKitExpressResponse`
- `status(code): unknown`
- `json(body): unknown`
- `getHeader(name): unknown`
- `setHeader(name, value): unknown`

`SessionKitExpressAdapterOptions`
- `onError?: (error: SessionKitError, req, res) => Promise<void> | void`

#### Functions

1. `createExpressHttpContext(req, res): HttpContext`

- Converts Express request/response into core `HttpContext`.

2. `toExpressMiddleware(middleware, options?): SessionKitExpressHandler`

- Converts a core middleware to an Express-compatible middleware.
- On `SessionKitError`:
  - uses `options.onError` first if provided
  - otherwise maps with `statusFromErrorCode` + `defaultErrorBody`

---

### `@sessionkit/hono`

#### Constant

- `SESSIONKIT_HONO_AUTH_KEY = "auth"`

#### Type

`SessionKitHonoAdapterOptions`
- `onError?: (error: SessionKitError, c: Context) => Promise<Response | void> | Response | void`

#### Functions

1. `createHonoHttpContext(c): HttpContext`

- Converts Hono `Context` into core `HttpContext`.

2. `toHonoMiddleware(middleware, options?): MiddlewareHandler`

- Converts a core middleware to Hono middleware.
- `SessionKitError` handling follows the same strategy as the Express adapter.

---

### `@sessionkit/redis`

#### Types

`SessionCodec<TPayload>`
- `serialize(value): string`
- `deserialize(raw): StoredSession<TPayload>`

`RedisSessionStoreOptions<TPayload>` (optional)
- `keyPrefix?: string` (default: `"sessionkit:sess:"`)
- `codec?: SessionCodec<TPayload>` (default: JSON codec)

`RedisLockProviderOptions` (optional)
- `keyPrefix?: string` (default: `"sessionkit:lock:"`)
- `acquireTimeoutMs?: number` (default: `5000`)
- `retryDelayMs?: number` (default: `50`)

`RedisClientLike`
- `get(key)`
- `set(...args)`
- `del(key)`
- `expire?(key, ttlSeconds)`
- `setEx?(key, ttlSeconds, value)`
- `setex?(key, ttlSeconds, value)`
- `eval?(...args)`
- `connect?()`
- `quit?()`
- `disconnect?()`
- `isOpen?: boolean`
- `status?: string`

`RedisConnectionParams` (all optional)
- `url?: string`
- `host?: string`
- `port?: number`
- `username?: string`
- `password?: string`
- `database?: number`
- `tls?: boolean`
- `lazyConnect?: boolean`
- `redisOptions?: Record<string, unknown>`

`RedisConnectionInput`
- `RedisClientLike`
- `{ client: RedisClientLike; manageClient?: boolean; lazyConnect?: boolean }`
- `RedisConnectionParams`

`RedisLockProviderInput`
- `RedisConnectionInput`
- `{ store: RedisSessionStore<unknown> }`

#### Classes

1. `RedisSessionStore<TPayload>`

- `constructor(connection: RedisConnectionInput, options?: RedisSessionStoreOptions<TPayload>)`
- Methods:
  - `get(sessionId)`
  - `set(sessionId, value, ttlSeconds)`
  - `del(sessionId)`
  - `touch(sessionId, ttlSeconds)`
  - `close()`
  - `getClientManager()` (exposed for lock provider reuse)

2. `RedisLockProvider`

- `constructor(input: RedisLockProviderInput, options?: RedisLockProviderOptions)`
- Methods:
  - `withLock<T>(key, ttlSeconds, fn): Promise<T>`
  - `close(): Promise<void>`

## Configuring an agenda

Recommended rollout sequence:

1. Define `SessionPayload` and `Principal` types.
2. Choose store strategy (`MapSessionStore` for local development, `RedisSessionStore` for shared/runtime environments).
3. Configure cookie policy (`httpOnly/sameSite/secure/domain/path`).
4. Configure `session.ttlSeconds` and whether rolling renewal is required.
5. Add `middleware()` and `requireAuth()` in routes.
6. If token rotation is needed, configure `token.shouldRefresh`, `token.refresh`, and `token.onRefreshFail`.
7. For multi-instance deployment, add `RedisLockProvider` to avoid refresh races.
8. Add integration tests for login, expiry, invalid session handling, and logout.

## Full documentation

- Primary docs (this README): https://github.com/harutostudio/sessionkit
- TypeDoc backup: https://harutostudio.github.io/sessionkit/
- Contributing: ./CONTRIBUTING.md
- Security policy: ./SECURITY.md

## Development

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm docs:build
```

## Release

```bash
pnpm changeset
pnpm version-packages
pnpm release
```

## License

Apache-2.0
