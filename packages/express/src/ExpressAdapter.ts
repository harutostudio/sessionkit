import {
  defaultErrorBody,
  SessionKitError,
  type HttpContext,
  type HttpMiddleware,
} from "@sessionkit/core";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";

export type SessionKitExpressRequest = {
  headers: Record<string, string | string[] | undefined>;
  auth?: unknown;
};

export type SessionKitExpressResponse = {
  status(code: number): unknown;
  json(body: unknown): unknown;
  getHeader(name: string): unknown;
  setHeader(name: string, value: unknown): unknown;
};

export type SessionKitExpressNext = (error?: unknown) => void;
export type SessionKitExpressHandler = (
  req: SessionKitExpressRequest,
  res: SessionKitExpressResponse,
  next: SessionKitExpressNext,
) => Promise<void>;

export type SessionKitExpressAdapterOptions = {
  onError?: (error: SessionKitError, req: SessionKitExpressRequest, res: SessionKitExpressResponse) => Promise<void> | void;
};

export function createExpressHttpContext(req: SessionKitExpressRequest, res: SessionKitExpressResponse): HttpContext {
  return {
    getCookie(name: string): string | null {
      const header = req.headers.cookie;
      if (!header) {
        return null;
      }

      const parsed = parseCookie(Array.isArray(header) ? header.join("; ") : header);
      return parsed[name] ?? null;
    },

    setCookie(name, value, options) {
      appendSetCookie(
        res,
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
      );
    },

    clearCookie(name, options) {
      appendSetCookie(
        res,
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
      );
    },

    setAuth<T>(value: T): void {
      req.auth = value;
    },

    getAuth<T>(): T | null {
      return (req.auth as T | undefined) ?? null;
    },

    status(code: number): void {
      res.status(code);
    },

    json(body: unknown): void {
      res.json(body);
    },
  };
}

export function toExpressMiddleware(
  middleware: HttpMiddleware,
  options?: SessionKitExpressAdapterOptions,
): SessionKitExpressHandler {
  return async (req, res, next) => {
    const ctx = createExpressHttpContext(req, res);

    try {
      await middleware(ctx, async () => {
        next();
      });
    } catch (error) {
      if (isSessionKitError(error)) {
        const sessionError = error;
        if (options?.onError) {
          await options.onError(sessionError, req, res);
          return;
        }

        res.status(statusFromErrorCode(sessionError.code));
        res.json(defaultErrorBody(sessionError.code, sessionError.message));
        return;
      }

      next(error);
    }
  };
}

function appendSetCookie(res: SessionKitExpressResponse, value: string): void {
  const prev = res.getHeader("Set-Cookie");

  if (!prev) {
    res.setHeader("Set-Cookie", value);
    return;
  }

  const list = Array.isArray(prev) ? prev.map(String) : [String(prev)];
  list.push(value);
  res.setHeader("Set-Cookie", list);
}

function toCookieSerializeOptions(value: Record<string, unknown>): Parameters<typeof serializeCookie>[2] {
  return value as Parameters<typeof serializeCookie>[2];
}

function isSessionKitError(error: unknown): error is SessionKitError {
  return error instanceof SessionKitError;
}

function statusFromErrorCode(code: string): number {
  switch (code) {
    case "UNAUTHORIZED":
    case "INVALID_SESSION":
    case "SESSION_EXPIRED":
      return 401;
    case "STORE_UNAVAILABLE":
    case "LOCK_TIMEOUT":
      return 503;
    case "INTERNAL_ERROR":
    default:
      return 500;
  }
}
