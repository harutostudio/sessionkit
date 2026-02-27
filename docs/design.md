# SessionKit Design

## Package boundaries

- `@sessionkit/core`
  - Framework agnostic only.
  - Owns `SessionKit`, core types, `SessionStore`, `MapSessionStore`, cookie/session abstractions.
  - Must not import any framework runtime/types.
- `@sessionkit/redis`
  - Implements `RedisSessionStore` only.
- `@sessionkit/express`
  - Express adapter from `req/res` to `HttpContext`.
- `@sessionkit/hono`
  - Hono adapter from `Context` to `HttpContext`.

## Release strategy

- Multi-package versioning with changesets.
- CI validates typecheck/build/test on every PR.
- Main branch triggers release workflow.

## Implementation order

1. `@sessionkit/core` interfaces + SessionKit behavior.
2. `@sessionkit/express` adapter and integration tests.
3. `@sessionkit/redis` store implementation.
4. `@sessionkit/hono` adapter.
