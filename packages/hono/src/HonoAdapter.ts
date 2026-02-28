import {
  defaultErrorBody,
  isSessionKitError,
  SessionKitError,
  statusFromErrorCode,
  type HttpContext,
  type HttpMiddleware,
} from "@sessionkit/core";
import type { Context, MiddlewareHandler } from "hono";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";

/**
 * Context key used to store SessionKit auth data on Hono context.
 */
export const SESSIONKIT_HONO_AUTH_KEY = "auth";

/**
 * Adapter options for Hono integration.
 */
export type SessionKitHonoAdapterOptions = {
  onError?: (error: SessionKitError, c: Context) => Promise<Response | void> | Response | void;
};

type HonoHttpContext = HttpContext & {
  _getDirectResponse: () => Response | null;
};

/**
 * Creates a framework-neutral `HttpContext` from Hono context.
 */
export function createHonoHttpContext(c: Context): HttpContext {
  let statusCode = 200;
  let directResponse: Response | null = null;

  const ctx: HonoHttpContext = {
    getCookie(name: string): string | null {
      const raw = c.req.header("cookie");
      if (!raw) {
        return null;
      }

      const parsed = parseCookie(raw);
      return parsed[name] ?? null;
    },

    setCookie(name, value, options) {
      c.header(
        "Set-Cookie",
        serializeCookie(
          name,
          value,
          toCookieSerializeOptions({
            path: options.path ?? "/",
            httpOnly: options.httpOnly ?? true,
            ...(options.domain !== undefined ? { domain: options.domain } : {}),
            ...(options.secure !== undefined ? { secure: options.secure } : {}),
            ...(options.sameSite !== undefined ? { sameSite: options.sameSite } : {}),
            ...(options.maxAgeSeconds !== undefined ? { maxAge: options.maxAgeSeconds } : {}),
          }),
        ),
        { append: true },
      );
    },

    clearCookie(name, options) {
      c.header(
        "Set-Cookie",
        serializeCookie(
          name,
          "",
          toCookieSerializeOptions({
            path: options.path ?? "/",
            httpOnly: options.httpOnly ?? true,
            maxAge: 0,
            ...(options.domain !== undefined ? { domain: options.domain } : {}),
            ...(options.secure !== undefined ? { secure: options.secure } : {}),
            ...(options.sameSite !== undefined ? { sameSite: options.sameSite } : {}),
          }),
        ),
        { append: true },
      );
    },

    setAuth<T>(value: T): void {
      (c.set as (key: string, value: unknown) => void)(SESSIONKIT_HONO_AUTH_KEY, value);
    },

    getAuth<T>(): T | null {
      return ((c.get as (key: string) => unknown)(SESSIONKIT_HONO_AUTH_KEY) as T | undefined) ?? null;
    },

    status(code: number): void {
      statusCode = code;
      (c.status as (value: number) => void)(code);
    },

    json(body: unknown): void {
      directResponse = (c.json as (value: unknown, status?: number) => Response)(body, statusCode);
    },
    _getDirectResponse(): Response | null {
      return directResponse;
    },
  };

  return ctx;
}

/**
 * Converts core middleware into a Hono middleware handler.
 */
export function toHonoMiddleware(
  middleware: HttpMiddleware,
  options?: SessionKitHonoAdapterOptions,
): MiddlewareHandler {
  return async (c, next) => {
    const ctx = createHonoHttpContext(c);

    let nextCalled = false;
    try {
      await middleware(ctx, async () => {
        nextCalled = true;
        await next();
      });
    } catch (error) {
      if (isSessionKitError(error)) {
        const sessionError = error;
        if (options?.onError) {
          const handled = await options.onError(sessionError, c);
          if (handled) {
            return handled;
          }
          if (c.finalized) {
            return;
          }
        }
        return (c.json as (value: unknown, status?: number) => Response)(
          defaultErrorBody(sessionError.code, sessionError.message),
          statusFromErrorCode(sessionError.code),
        );
      }
      throw error;
    }

    if (c.finalized) {
      return;
    }

    if (!nextCalled) {
      const response = (ctx as HonoHttpContext)._getDirectResponse();
      if (response) {
        return response;
      }
      return (c.body as (data: null, status?: number) => Response)(null, c.res.status || 200);
    }
  };
}

function toCookieSerializeOptions(value: Record<string, unknown>): Parameters<typeof serializeCookie>[2] {
  return value as Parameters<typeof serializeCookie>[2];
}
