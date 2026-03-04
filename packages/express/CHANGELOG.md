# @sessionkit/express

## 0.2.0

### Minor Changes

- 7588eae: Add adapter-bound SessionKit factories (`createExpressSessionKit` and `createHonoSessionKit`) so apps can configure the adapter once and then call `sessionKit.middleware()` / `requireAuth()` directly without wrapping via `to*Middleware` each time.

  Also update README tutorial and API docs to show the new adapter-bound usage pattern.

All notable changes to this package will be documented in this file.
