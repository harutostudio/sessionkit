# SessionKit API (Draft)

## Core

- `SessionKit<TPayload, TPrincipal>`
- `SessionKitOptions<TPayload, TPrincipal>`
- `SessionStore<TPayload>`
- `MapSessionStore<TPayload>`
- `HttpContext`, `HttpMiddleware`

## Redis

- `RedisSessionStore<TPayload>`

## Express

- `createExpressMiddleware(...)`
- `toExpressHttpContext(...)`

## Hono

- `createHonoMiddleware(...)`
- `toHonoHttpContext(...)`

## Error model

```json
{
  "error": {
    "code": "SOME_CODE",
    "message": "English message."
  }
}
```
