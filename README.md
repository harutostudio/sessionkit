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

This section documents all public exports from package entry points. Each subsection ends with a runnable-style example.

### `@sessionkit/core`

#### Class: `SessionKit<TPayload, TPrincipal>`

### constructor(opts)

Creates a SessionKit runtime with store, session policy, cookie policy, principal projection, and optional hooks.

```ts
const kit = new SessionKit<Payload, Principal>({
  // required: session persistence implementation
  store,
  // required: baseline session TTL policy
  session: { ttlSeconds: 3600 },
  // required: map payload into principal exposed to app code
  principalFactory(payload) {
    return { id: payload.userId };
  },
});
```

### middleware()

Creates middleware that resolves session state from cookie + store and hydrates auth context for the current request.

```ts
// place early so downstream handlers can read auth context
app.use(toExpressMiddleware(kit.middleware()));
```

### optionalAuth()

Creates middleware equivalent to `middleware()`. This is an intent-oriented alias when authentication is optional.

```ts
// same behavior as middleware(), clearer route intent naming
app.use(toExpressMiddleware(kit.optionalAuth()));
```

### requireAuth([options])

Creates middleware that enforces authenticated access. If the request is unauthenticated, handling priority is `options.onFail`, then configured `hooks.onUnauthorized`, then throwing `SessionKitError("UNAUTHORIZED", ...)`.

`options` is optional and contains:

- `onFail`: custom unauthenticated handler `(ctx) => void | Promise<void>`

```ts
app.get("/private", toExpressMiddleware(kit.requireAuth()), handler);

app.get(
  "/private-custom",
  toExpressMiddleware(
    kit.requireAuth({
      // option: override unauthenticated behavior for this route
      onFail(ctx) {
        ctx.status(401);
        ctx.json({ error: "login required" });
      },
    }),
  ),
  handler,
);
```

### signIn(ctx, payload, [options])

Creates a new session, stores it, sets cookie, and returns `SignInResult<TPrincipal>`.

`options` is optional and contains:

- `ttlSeconds`: per-call TTL override (default is `session.ttlSeconds`)
- `hydrateContext`: whether to set auth context immediately in current request (default is `true`)

```ts
const result = await kit.signIn(
  ctx,
  {
    // payload: your stored session data
    userId: "u_001",
    role: "admin",
  },
  {
    // option: override TTL for this sign-in only
    ttlSeconds: 900,
    // option: immediately mark current request as authenticated
    hydrateContext: true,
  },
);

console.log(result.sessionId, result.principal, result.expiresAt);
```

### signOut(ctx, [options])

Deletes session from store, clears cookie, and resets auth context to unauthenticated.

`options` is optional and contains:

- `alwaysClearCookie`: if `true`, cookie is cleared even when store delete fails; if `false`, delete failure throws

```ts
await kit.signOut(ctx, {
  // option: fail hard if store deletion fails
  alwaysClearCookie: false,
});
```

### getAuth(ctx)

Reads auth context from request context and returns an unauthenticated default object when none is present.

```ts
const auth = kit.getAuth(ctx);

// shape includes: sessionId, session, principal, isAuthenticated
if (!auth.isAuthenticated) {
  // handle guest flow
}
```

#### Type: `SessionKitOptions<TPayload, TPrincipal>`

Defines runtime configuration for `new SessionKit(...)`, including required store/session/principal settings and optional cookie, token-refresh, lock, hook, and logger settings.

`session` options are:

- `rolling`
- `touchEverySeconds`
- `renewBeforeSeconds`

`token` options are:

- `onRefreshFail`

```ts
const kit = new SessionKit<Payload, Principal>({
  store,
  cookie: {
    // option: cookie name (default: "sid")
    name: "sid",
    // option: cookie path (default: "/")
    path: "/",
    // option: cookie domain
    domain: "example.com",
    // option: client-side JS access (default: true means HttpOnly enabled)
    httpOnly: true,
    // option: secure cookie for HTTPS
    secure: true,
    // option: lax | strict | none (default: "lax")
    sameSite: "lax",
    // option: explicit max-age override in seconds
    maxAgeSeconds: 3600,
  },
  session: {
    ttlSeconds: 3600,
    // option: enable rolling renewal
    rolling: true,
    // option: fallback renewal threshold in seconds
    touchEverySeconds: 60,
    // option: preferred renewal threshold in seconds
    renewBeforeSeconds: 30,
  },
  principalFactory(payload) {
    return { id: payload.userId, role: payload.role };
  },
  payloadTransformer(raw) {
    // option: migrate/validate legacy payload shape
    return raw as Payload;
  },
  token: {
    shouldRefresh(payload, nowMs) {
      return payload.accessTokenExpMs - nowMs < 60_000;
    },
    async refresh(payload) {
      const refreshed = await refreshToken(payload.refreshToken);
      return {
        payload: {
          ...payload,
          accessToken: refreshed.accessToken,
          accessTokenExpMs: refreshed.expMs,
        },
        // option: override TTL after refresh
        ttlSeconds: 3600,
      };
    },
    // option: unauth | revoke
    onRefreshFail: "revoke",
  },
  lockProvider,
  hooks: {
    onUnauthorized(ctx) {
      ctx.status(401);
      ctx.json({ error: "unauthorized" });
    },
    onInvalidSession(ctx, reason) {
      console.warn("invalid session", reason);
    },
  },
  logger: console,
});
```

#### Type: `CookieOptions`

Defines cookie-level behavior used by core and adapters.

```ts
const cookieOptions = {
  // option: default is "sid"
  name: "sid",
  // option: default is "/"
  path: "/",
  // option: cookie scope domain
  domain: "example.com",
  // option: default is true
  httpOnly: true,
  // option: set true for HTTPS deployment
  secure: true,
  // option: default is "lax"
  sameSite: "strict",
  // option: max-age in seconds
  maxAgeSeconds: 1800,
};
```

#### Interface: `HttpContext`

Defines the framework-neutral contract SessionKit uses to read cookies, write cookies, store auth context, and emit response status/body.

```ts
const ctx: HttpContext = {
  getCookie(name) {
    return null;
  },
  setCookie(name, value, options) {
    // options includes cookie flags and optional maxAgeSeconds
  },
  clearCookie(name, options) {
    // clears cookie using provided cookie scope
  },
  setAuth(value) {
    // attach auth context for current request
  },
  getAuth() {
    return null;
  },
  status(code) {
    // set response status
  },
  json(body) {
    // write JSON response
  },
};
```

#### Type: `HttpMiddleware`

Defines middleware signature accepted by adapters.

```ts
const middleware: HttpMiddleware = async (ctx, next) => {
  // perform work before downstream
  await next();
  // perform work after downstream
};
```

#### Store API

Defines storage contracts and the bundled in-memory implementation.

`SessionStore<TPayload>` optional options are:

- `touch`
- `close`

`MapSessionStore` constructor options are:

- `cleanupIntervalSeconds`
- `maxSize`

```ts
const memoryStore = new MapSessionStore<Payload>({
  // option: cleanup interval in seconds
  cleanupIntervalSeconds: 60,
  // option: max entries before naive eviction
  maxSize: 10_000,
});

await memoryStore.set("sid-1", { payload: { userId: "u1" }, createdAt: Date.now(), expiresAt: Date.now() + 3600_000 }, 3600);
const session = await memoryStore.get("sid-1");
await memoryStore.touch?.("sid-1", 3600);
await memoryStore.del("sid-1");
await memoryStore.close?.();
```

#### Lock API

Defines distributed lock contract and the bundled no-op implementation.

```ts
const lock = new NoopLockProvider();

const result = await lock.withLock("sessionkit:refresh:sid-1", 10, async () => {
  // critical section
  return "ok";
});
```

#### Error API

Defines error code model, canonical error type, and helper utilities used by adapters.

```ts
try {
  throw new SessionKitError("UNAUTHORIZED", "Authentication required.");
} catch (error) {
  if (isSessionKitError(error)) {
    const status = statusFromErrorCode(error.code);
    const body = defaultErrorBody(error.code, error.message);
    console.log(status, body);
  }
}
```

#### Cookie helper functions

Provides parser/serializer helpers used by adapters and custom integrations.

```ts
const parsed = parseCookieHeader("sid=abc123; theme=dark");
const setHeader = serializeSetCookie("sid", "abc123", {
  // option: cookie path
  path: "/",
  // option: secure + httponly flags
  secure: true,
  httpOnly: true,
  // option: same-site policy
  sameSite: "lax",
  // option: explicit max-age
  maxAgeSeconds: 3600,
});
const clearHeader = serializeClearCookie("sid", { path: "/" });
```

### `@sessionkit/express`

#### Type: `SessionKitExpressRequest`

Defines minimal request shape required by the Express adapter.

```ts
const req: SessionKitExpressRequest = {
  headers: {
    cookie: "sid=abc123",
  },
  auth: undefined,
};
```

#### Type: `SessionKitExpressResponse`

Defines minimal response shape required by the Express adapter.

```ts
const res: SessionKitExpressResponse = {
  status(code) {
    return code;
  },
  json(body) {
    return body;
  },
  getHeader(name) {
    return undefined;
  },
  setHeader(name, value) {
    return value;
  },
};
```

#### Function: `createExpressHttpContext(req, res)`

Converts Express request/response objects into core `HttpContext`.

```ts
const ctx = createExpressHttpContext(req, res);
await kit.signIn(ctx, { userId: "u_001", role: "user" });
```

#### Function: `toExpressMiddleware(middleware, [options])`

Converts core middleware to Express middleware and maps `SessionKitError` to HTTP responses.

`options` is optional and contains:

- `onError`: custom SessionKitError handler

```ts
app.use(
  toExpressMiddleware(kit.middleware(), {
    // option: customize adapter-level error output
    onError(error, req, res) {
      res.status(500);
      res.json({ code: error.code, message: error.message });
    },
  }),
);
```

### `@sessionkit/hono`

#### Constant: `SESSIONKIT_HONO_AUTH_KEY`

Defines the context key used by the Hono adapter to store auth context.

```ts
console.log(SESSIONKIT_HONO_AUTH_KEY); // "auth"
```

#### Type: `SessionKitHonoAdapterOptions`

Defines adapter-level error customization for Hono integration.

`options` is optional and contains:

- `onError`: custom SessionKitError handler returning `Response | void`

```ts
app.use(
  "*",
  toHonoMiddleware(kit.middleware(), {
    // option: customize error mapping
    onError(error, c) {
      return c.json({ code: error.code, message: error.message }, 500);
    },
  }),
);
```

#### Function: `createHonoHttpContext(c)`

Converts Hono `Context` into core `HttpContext`.

```ts
const ctx = createHonoHttpContext(c);
const auth = kit.getAuth(ctx);
```

#### Function: `toHonoMiddleware(middleware, [options])`

Converts core middleware to Hono middleware and handles SessionKit error mapping.

`options` is optional and contains:

- `onError`: custom SessionKitError handler returning `Response | void`

```ts
app.use("/private/*", toHonoMiddleware(kit.requireAuth()));
```

### `@sessionkit/redis`

#### Type: `SessionCodec<TPayload>`

Defines custom serialization/deserialization strategy for persisted sessions.

```ts
const codec: SessionCodec<Payload> = {
  serialize(value) {
    return JSON.stringify(value);
  },
  deserialize(raw) {
    return JSON.parse(raw) as StoredSession<Payload>;
  },
};
```

#### Type: `RedisSessionStoreOptions<TPayload>`

Defines optional Redis store behavior.

`options` is optional and contains:

- `keyPrefix`
- `codec`

```ts
const store = new RedisSessionStore<Payload>(
  { url: "redis://localhost:6379" },
  {
    // option: namespacing key prefix
    keyPrefix: "sessionkit:sess:",
    // option: custom codec
    codec,
  },
);
```

#### Type: `RedisLockProviderOptions`

Defines optional lock acquisition behavior.

`options` is optional and contains:

- `keyPrefix`
- `acquireTimeoutMs`
- `retryDelayMs`

```ts
const lockProvider = new RedisLockProvider(
  { url: "redis://localhost:6379" },
  {
    // option: lock key namespace
    keyPrefix: "sessionkit:lock:",
    // option: max wait to acquire lock
    acquireTimeoutMs: 5000,
    // option: polling delay while waiting lock
    retryDelayMs: 50,
  },
);
```

#### Type: `RedisConnectionParams`

Defines parameterized Redis connection input.

`options` is optional and contains:

- `url`
- `host`
- `port`
- `username`
- `password`
- `database`
- `tls`
- `lazyConnect`
- `redisOptions`

```ts
const connection: RedisConnectionParams = {
  // option: full URL
  url: "redis://localhost:6379",
  // option: enable lazy connect
  lazyConnect: false,
};
```

#### Type: `RedisConnectionInput`

Represents accepted constructor input for Redis store and lock provider.

```ts
const byClient: RedisConnectionInput = redisClient;
const byWrapper: RedisConnectionInput = { client: redisClient, manageClient: false, lazyConnect: true };
const byParams: RedisConnectionInput = { url: "redis://localhost:6379" };
```

#### Type: `RedisLockProviderInput`

Represents accepted constructor input for `RedisLockProvider`.

```ts
const lockInputByParams: RedisLockProviderInput = { url: "redis://localhost:6379" };
const lockInputByStore: RedisLockProviderInput = { store };
```

#### Class: `RedisSessionStore<TPayload>`

Redis-backed session store implementation for SessionKit.

```ts
const store = new RedisSessionStore<Payload>({ url: "redis://localhost:6379" });

await store.set("sid-1", { payload: { userId: "u1" }, createdAt: Date.now(), expiresAt: Date.now() + 3600_000 }, 3600);
const session = await store.get("sid-1");
await store.touch("sid-1", 3600);
await store.del("sid-1");
await store.close();
```

#### Class: `RedisLockProvider`

Redis-backed distributed lock provider, commonly used for token refresh race control.

```ts
const lock = new RedisLockProvider({ url: "redis://localhost:6379" });

await lock.withLock("sessionkit:refresh:sid-1", 10, async () => {
  // critical section work
});

await lock.close();
```
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
