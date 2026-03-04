---
"@sessionkit/express": minor
"@sessionkit/hono": minor
---

Add adapter-bound SessionKit factories (`createExpressSessionKit` and `createHonoSessionKit`) so apps can configure the adapter once and then call `sessionKit.middleware()` / `requireAuth()` directly without wrapping via `to*Middleware` each time.

Also update README tutorial and API docs to show the new adapter-bound usage pattern.
