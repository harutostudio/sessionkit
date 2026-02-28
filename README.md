# SessionKit

SessionKit is a framework-agnostic, class-based cookie session engine for Node.js runtimes.

It provides a strict core for session lifecycle and authentication state, then connects that core to web frameworks through thin adapters.

## What is SessionKit

SessionKit is built for teams that want predictable session behavior without coupling business logic to a specific HTTP framework.

- `@sessionkit/core` handles session read/write, rolling expiration, sign-in/sign-out, and auth guards.
- `@sessionkit/express` and `@sessionkit/hono` adapt the core middleware to framework-specific request/response models.
- `@sessionkit/redis` provides Redis-backed session persistence and a lock provider for refresh concurrency control.

## Key Features

- Framework-agnostic session core with typed auth context
- Class-based API (`SessionKit`) that is easy to compose in application layers
- Cookie-based session ID transport
- Pluggable session store interface (in-memory, Redis, custom)
- Optional rolling sessions with TTL touch/renew behavior
- Optional token refresh flow with distributed lock support
- Explicit error model (`SessionKitError`) for consistent adapter-level HTTP mapping

## SessionKit offers

- A clear separation between session logic and transport/runtime concerns
- Type-safe principal derivation from session payload
- Hooks for unauthorized and invalid-session handling
- Adapter-level helpers for Express and Hono integration
- Redis primitives for production-grade persistence and locking

## Installation

Install only what you need.

### Core only

```bash
npm install @sessionkit/core
```

### Core + Express

```bash
npm install @sessionkit/core @sessionkit/express express
```

### Core + Hono

```bash
npm install @sessionkit/core @sessionkit/hono hono
```

### Core + Redis store

```bash
npm install @sessionkit/core @sessionkit/redis redis
```

## Example Usage

The example below uses Express with in-memory store (`MapSessionStore`) for quick start.

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

const store = new MapSessionStore<SessionPayload>();

const sessionKit = new SessionKit<SessionPayload, Principal>({
  store,
  session: {
    ttlSeconds: 60 * 60 * 24, // 24h
    rolling: true,
    renewBeforeSeconds: 60,
  },
  cookie: {
    name: "sid",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
  principalFactory(payload) {
    return { id: payload.userId, role: payload.role };
  },
});

const app = express();
app.use(express.json());

// Hydrate req.auth for every request.
app.use(toExpressMiddleware(sessionKit.middleware()));

app.post("/login", async (req, res, next) => {
  try {
    const ctx = createExpressHttpContext(req, res);
    await sessionKit.signIn(ctx, { userId: "u_123", role: "user" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get(
  "/me",
  toExpressMiddleware(sessionKit.requireAuth()),
  (req, res) => {
    res.json({ auth: req.auth });
  },
);

app.listen(3000);
```

Note: in real routes, call `signIn`/`signOut` with the same framework context abstraction used by your adapter layer.

## Full documentation

- Repository: https://github.com/harutostudio/sessionkit
- API Reference (TypeDoc): https://harutostudio.github.io/sessionkit/
- Contributing Guide: ./CONTRIBUTING.md
- Security Policy: ./SECURITY.md

## Configuring an agenda

A practical rollout agenda for adopting SessionKit in production:

1. Define your session payload schema and principal shape.
2. Choose a store strategy (`MapSessionStore` for local/dev, `RedisSessionStore` for shared environments).
3. Set cookie policy (`httpOnly`, `sameSite`, `secure`, `domain`, `path`) based on deployment topology.
4. Configure session TTL and whether rolling renewal is required.
5. Add `requireAuth()` to protected routes and decide unauthorized behavior via hooks.
6. If using rotating tokens, configure `token.shouldRefresh`, `token.refresh`, and lock provider.
7. Validate with integration tests: login, protected route access, expiry, sign-out, and invalid-session handling.

## Packages

- `@sessionkit/core`
- `@sessionkit/redis`
- `@sessionkit/express`
- `@sessionkit/hono`

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

MIT
