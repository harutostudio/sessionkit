import type { CookieOptions } from "../cookie/CookieCodec";

/**
 * Framework-neutral HTTP context required by SessionKit.
 */
export interface HttpContext {
    // Cookie I/O
    getCookie(name: string): string | null;
    setCookie(name: string, value: string, options: CookieOptions & { maxAgeSeconds?: number }): void;
    clearCookie(name: string, options: CookieOptions): void;

    // Auth context storage
    setAuth<T>(value: T): void;
    getAuth<T>(): T | null;

    // Response helpers (adapters should implement these)
    status(code: number): void;
    json(body: unknown): void;
}

/**
 * Middleware function signature used by SessionKit core.
 */
export type HttpMiddleware = (ctx: HttpContext, next: () => Promise<void>) => Promise<void>;
