import type { CookieOptions } from "../cookie/CookieCodec";

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

export type HttpMiddleware = (ctx: HttpContext, next: () => Promise<void>) => Promise<void>;