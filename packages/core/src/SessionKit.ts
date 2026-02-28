import type {
    AuthContext,
    RequireAuthOptions,
    SessionKitOptions,
    SignInOptions,
    SignInResult,
    SignOutOptions,
} from "./types";
import type { HttpContext, HttpMiddleware } from "./http/HttpContext";
import { NoopLockProvider } from "./session/LockProvider";
import { SessionKitError, toSessionKitError } from "./errors";
import { nowMs, secondsToMs } from "./utils/time";
import { newSessionId } from "./utils/uuid";

const TOKEN_REFRESH_LOCK_TTL_SECONDS = 10;

function defaultCookieName(opts: SessionKitOptions<any, any>): string {
    return opts.cookie?.name ?? "sid";
}

function defaultRenewBeforeSeconds(opts: SessionKitOptions<any, any>): number {
    return opts.session.renewBeforeSeconds ?? opts.session.touchEverySeconds ?? 60;
}

type InternalAuth<TPayload, TPrincipal> = AuthContext<TPayload, TPrincipal>;

export class SessionKit<TPayload, TPrincipal> {
    private readonly cookieName: string;
    private readonly lockProvider: NoopLockProvider | NonNullable<SessionKitOptions<TPayload, TPrincipal>["lockProvider"]>;

    constructor(private readonly opts: SessionKitOptions<TPayload, TPrincipal>) {
        this.cookieName = defaultCookieName(opts);
        this.lockProvider = opts.lockProvider ?? new NoopLockProvider();
    }

    middleware(): HttpMiddleware {
        return async (ctx, next) => {
            try {
                const auth = await this.buildAuthContext(ctx);
                ctx.setAuth<InternalAuth<TPayload, TPrincipal>>(auth);
                await next();
            } catch (error) {
                throw toSessionKitError(error);
            }
        };
    }

    optionalAuth(): HttpMiddleware {
        return this.middleware();
    }

    requireAuth(options?: RequireAuthOptions): HttpMiddleware {
        return async (ctx, next) => {
            const auth = this.getAuth(ctx);
            if (!auth.isAuthenticated) {
                if (options?.onFail) {
                    await options.onFail(ctx);
                    return;
                }
                if (this.opts.hooks?.onUnauthorized) {
                    await this.opts.hooks.onUnauthorized(ctx);
                    return;
                }
                throw new SessionKitError("UNAUTHORIZED", "Authentication required.");
            }
            await next();
        };
    }

    async signIn(
        ctx: HttpContext,
        payload: TPayload,
        options?: SignInOptions
    ): Promise<SignInResult<TPrincipal>> {
        const ttl = options?.ttlSeconds ?? this.opts.session.ttlSeconds;
        const createdAt = nowMs();
        const expiresAt = createdAt + secondsToMs(ttl);
        const sessionId = newSessionId();

        try {
            await this.opts.store.set(
                sessionId,
                { payload, createdAt, expiresAt },
                ttl
            );
        } catch (error) {
            throw new SessionKitError("STORE_UNAVAILABLE", "Failed to save session.", error);
        }

        const maxAgeSeconds = this.opts.cookie?.maxAgeSeconds ?? ttl;
        ctx.setCookie(this.cookieName, sessionId, { ...(this.opts.cookie ?? {}), maxAgeSeconds });

        const principal = this.opts.principalFactory(payload);

        if (options?.hydrateContext ?? true) {
            ctx.setAuth<InternalAuth<TPayload, TPrincipal>>({
                sessionId,
                session: { payload, createdAt, expiresAt },
                principal,
                isAuthenticated: true,
            });
        }

        return { sessionId, principal, expiresAt };
    }

    async signOut(ctx: HttpContext, options?: SignOutOptions): Promise<void> {
        const alwaysClear = options?.alwaysClearCookie ?? true;
        const sid = ctx.getCookie(this.cookieName);

        try {
            if (sid) {
                await this.opts.store.del(sid);
            }
        } catch (e) {
            this.opts.logger?.warn("Failed to delete session from store.", { error: e });
            if (!alwaysClear) {
                throw new SessionKitError("STORE_UNAVAILABLE", "Failed to delete session.", e);
            }
        }

        ctx.clearCookie(this.cookieName, this.opts.cookie ?? {});
        ctx.setAuth<InternalAuth<TPayload, TPrincipal>>({
            sessionId: null,
            session: null,
            principal: null,
            isAuthenticated: false,
        });
    }

    getAuth(ctx: HttpContext): AuthContext<TPayload, TPrincipal> {
        const found = ctx.getAuth<InternalAuth<TPayload, TPrincipal>>();
        if (found) return stripInternal(found);

        return {
            sessionId: null,
            session: null,
            principal: null,
            isAuthenticated: false,
        };
    }

    private async buildAuthContext(ctx: HttpContext): Promise<InternalAuth<TPayload, TPrincipal>> {
        const sid = ctx.getCookie(this.cookieName);
        if (!sid) {
            return unauthContext();
        }

        let stored: NonNullable<InternalAuth<TPayload, TPrincipal>["session"]> | null;
        try {
            stored = await this.opts.store.get(sid);
        } catch (error) {
            throw new SessionKitError("STORE_UNAVAILABLE", "Failed to read session.", error);
        }
        if (!stored) {
            this.opts.logger?.debug("Session not found.", { sessionId: sid });
            ctx.clearCookie(this.cookieName, this.opts.cookie ?? {});
            if (this.opts.hooks?.onInvalidSession) {
                await this.opts.hooks.onInvalidSession(ctx, "SESSION_NOT_FOUND");
            }
            return unauthContext();
        }

        // Optional payload migration
        try {
            if (this.opts.payloadTransformer) {
                // allow transforming payload only (not createdAt/expiresAt)
                const transformed = this.opts.payloadTransformer(stored.payload as unknown);
                stored = { ...stored, payload: transformed };
            }
        } catch (e) {
            this.opts.logger?.warn("Invalid session payload.", { error: e });
            ctx.clearCookie(this.cookieName, this.opts.cookie ?? {});
            if (this.opts.hooks?.onInvalidSession) {
                await this.opts.hooks.onInvalidSession(ctx, "INVALID_PAYLOAD");
            }
            return unauthContext();
        }

        if (nowMs() >= stored.expiresAt) {
            this.opts.logger?.debug("Session expired.", { sessionId: sid });
            ctx.clearCookie(this.cookieName, this.opts.cookie ?? {});
            return unauthContext();
        }

        stored = await this.maybeRefreshTokenSession(ctx, sid, stored);
        if (!stored) {
            return unauthContext();
        }

        const principal = this.opts.principalFactory(stored.payload);

        const auth: InternalAuth<TPayload, TPrincipal> = {
            sessionId: sid,
            session: stored,
            principal,
            isAuthenticated: true,
        };

        // rolling touch (avoid touching too frequently)
        if (this.opts.session.rolling) {
            const renewBeforeSeconds = defaultRenewBeforeSeconds(this.opts);
            await this.maybeTouch(sid, renewBeforeSeconds, this.opts.session.ttlSeconds, auth);
        }

        return auth;
    }

    private async maybeRefreshTokenSession(
        ctx: HttpContext,
        sessionId: string,
        stored: NonNullable<InternalAuth<TPayload, TPrincipal>["session"]>
    ): Promise<NonNullable<InternalAuth<TPayload, TPrincipal>["session"]> | null> {
        const token = this.opts.token;
        if (!token) {
            return stored;
        }

        if (!token.shouldRefresh(stored.payload, nowMs())) {
            return stored;
        }

        try {
            return await this.lockProvider.withLock(
                `sessionkit:refresh:${sessionId}`,
                TOKEN_REFRESH_LOCK_TTL_SECONDS,
                async () => {
                    let latest;
                    try {
                        latest = await this.opts.store.get(sessionId);
                    } catch (storeError) {
                        throw new SessionKitError("STORE_UNAVAILABLE", "Failed to read session.", storeError);
                    }
                    if (!latest) {
                        return null;
                    }

                    if (nowMs() >= latest.expiresAt) {
                        return null;
                    }

                    if (!token.shouldRefresh(latest.payload, nowMs())) {
                        return latest;
                    }

                    let refreshed;
                    try {
                        refreshed = await token.refresh(latest.payload);
                    } catch (refreshError) {
                        throw new SessionKitError("TOKEN_REFRESH_FAILED", "Failed to refresh token.", refreshError);
                    }
                    const ttlSeconds = refreshed.ttlSeconds ?? this.opts.session.ttlSeconds;
                    const nextStored = {
                        ...latest,
                        payload: refreshed.payload,
                        expiresAt: nowMs() + secondsToMs(ttlSeconds),
                    };

                    try {
                        await this.opts.store.set(sessionId, nextStored, ttlSeconds);
                    } catch (storeError) {
                        throw new SessionKitError("STORE_UNAVAILABLE", "Failed to save session.", storeError);
                    }
                    return nextStored;
                }
            );
        } catch (error) {
            const normalized = toSessionKitError(error);
            if (normalized.code !== "TOKEN_REFRESH_FAILED") {
                throw normalized;
            }

            await this.handleRefreshFailure(ctx, sessionId, normalized);
            return null;
        }
    }

    private async handleRefreshFailure(ctx: HttpContext, sessionId: string, error: unknown): Promise<void> {
        this.opts.logger?.warn("Token refresh failed.", { sessionId, error });

        if ((this.opts.token?.onRefreshFail ?? "unauth") === "revoke") {
            try {
                await this.opts.store.del(sessionId);
            } catch (storeError) {
                this.opts.logger?.warn("Failed to revoke session after refresh failure.", {
                    sessionId,
                    error: storeError,
                });
            }
        }

        if (this.opts.hooks?.onInvalidSession) {
            await this.opts.hooks.onInvalidSession(ctx, "TOKEN_REFRESH_FAILED");
        }

        ctx.clearCookie(this.cookieName, this.opts.cookie ?? {});
    }

    private async maybeTouch(
        sessionId: string,
        renewBeforeSeconds: number,
        ttlSeconds: number,
        auth: InternalAuth<TPayload, TPrincipal>
    ): Promise<void> {
        const now = nowMs();
        const expiresAt = auth.session?.expiresAt ?? 0;
        const remainingSeconds = Math.floor((expiresAt - now) / 1000);
        if (remainingSeconds > renewBeforeSeconds) {
            return;
        }

        try {
            if (this.opts.store.touch) {
                await this.opts.store.touch(sessionId, ttlSeconds);
                if (auth.session) {
                    auth.session = { ...auth.session, expiresAt: now + secondsToMs(ttlSeconds) };
                }
            } else {
                const s = auth.session!;
                await this.opts.store.set(
                    sessionId,
                    { ...s, expiresAt: now + secondsToMs(ttlSeconds) },
                    ttlSeconds
                );
                auth.session = { ...s, expiresAt: now + secondsToMs(ttlSeconds) };
            }
        } catch (e) {
            this.opts.logger?.warn("Failed to touch session TTL.", { error: e });
        }
    }
}

function unauthContext<TPayload, TPrincipal>(): InternalAuth<TPayload, TPrincipal> {
    return {
        sessionId: null,
        session: null,
        principal: null,
        isAuthenticated: false,
    };
}

function stripInternal<TPayload, TPrincipal>(
    v: InternalAuth<TPayload, TPrincipal>
): AuthContext<TPayload, TPrincipal> {
    return {
        sessionId: v.sessionId,
        session: v.session,
        principal: v.principal,
        isAuthenticated: v.isAuthenticated,
    };
}
