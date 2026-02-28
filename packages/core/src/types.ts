import type {CookieOptions} from "./cookie/CookieCodec";
import type {SessionStore, StoredSession} from "./store/SessionStore";
import type {HttpContext, HttpMiddleware} from "./http/HttpContext";
import type {ErrorCode, Logger} from "./errors";
import type {LockProvider} from "./session/LockProvider";

export type AuthContext<TPayload, TPrincipal> = {
    sessionId: string | null;
    session: StoredSession<TPayload> | null;
    principal: TPrincipal | null;
    isAuthenticated: boolean;
};

export type SessionKitOptions<TPayload, TPrincipal> = {
    store: SessionStore<TPayload>;

    cookie?: CookieOptions;

    session: {
        ttlSeconds: number;
        rolling?: boolean;          // default false
        touchEverySeconds?: number; // default 60
    };

    principalFactory: (payload: TPayload) => TPrincipal;

    payloadTransformer?: (raw: unknown) => TPayload;

    token?: {
        shouldRefresh: (payload: TPayload, nowMs: number) => boolean;
        refresh: (payload: TPayload) => Promise<{
            payload: TPayload;
            ttlSeconds?: number;
        }>;
        onRefreshFail?: "unauth" | "revoke";
    };

    lockProvider?: LockProvider;

    hooks?: {
        onUnauthorized?: (ctx: HttpContext) => Promise<void> | void;
        onInvalidSession?: (ctx: HttpContext, reason: ErrorCode | string) => Promise<void> | void;
    };

    logger?: Logger;
};

export type RequireAuthOptions = {
    onFail?: (ctx: HttpContext) => Promise<void> | void;
};

export type SignInOptions = {
    ttlSeconds?: number;
    hydrateContext?: boolean; // default true
};

export type SignInResult<TPrincipal> = {
    sessionId: string;
    principal: TPrincipal;
    expiresAt: number;
};

export type SignOutOptions = {
    alwaysClearCookie?: boolean; // default true
};

// Re-export commonly used types
export type {CookieOptions, SessionStore, StoredSession, HttpContext, HttpMiddleware};
