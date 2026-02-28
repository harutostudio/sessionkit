import { describe, expect, it } from "vitest";
import { SessionKit } from "../src";
import { MapSessionStore } from "../src";
import type { HttpContext } from "../src";
import type { SessionStore, StoredSession } from "../src";
import { SessionKitError } from "../src";

type CookieRecord = {
  name: string;
  value: string;
};

class FakeHttpContext implements HttpContext {
  private auth: unknown = null;
  private readonly requestCookies: Map<string, string>;
  readonly setCookies: CookieRecord[] = [];
  readonly clearedCookies: string[] = [];
  responseStatus = 200;
  responseBody: unknown = null;

  constructor(private readonly jar: Map<string, string>) {
    this.requestCookies = new Map(jar);
  }

  getCookie(name: string): string | null {
    return this.requestCookies.get(name) ?? null;
  }

  setCookie(name: string, value: string): void {
    this.jar.set(name, value);
    this.setCookies.push({ name, value });
  }

  clearCookie(name: string): void {
    this.jar.delete(name);
    this.clearedCookies.push(name);
  }

  setAuth<T>(value: T): void {
    this.auth = value;
  }

  getAuth<T>(): T | null {
    return (this.auth as T | null) ?? null;
  }

  status(code: number): void {
    this.responseStatus = code;
  }

  json(body: unknown): void {
    this.responseBody = body;
  }
}

function createKit(store: SessionStore<{ userId: string; refreshToken?: string }>) {
  return new SessionKit<{ userId: string; refreshToken?: string }, { userId: string }>({
    store,
    session: {
      ttlSeconds: 120,
      rolling: true,
      renewBeforeSeconds: 10,
    },
    principalFactory: (payload) => ({ userId: payload.userId }),
  });
}

describe("SessionKit", () => {
  it("signIn_sets_cookie_and_store_and_auth", async () => {
    const jar = new Map<string, string>();
    const store = new MapSessionStore<{ userId: string; refreshToken?: string }>();
    const kit = createKit(store);
    const ctx = new FakeHttpContext(jar);

    await kit.signIn(ctx, { userId: "u1", refreshToken: "rt1" });

    expect(ctx.setCookies).toHaveLength(1);
    expect(ctx.setCookies[0]?.name).toBe("sid");

    const sid = jar.get("sid");
    expect(sid).toBeTruthy();
    const stored = await store.get(sid as string);
    expect(stored?.payload.userId).toBe("u1");

    const auth = kit.getAuth(ctx);
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.principal?.userId).toBe("u1");

    await store.close?.();
  });

  it("middleware_loads_session_and_injects_principal", async () => {
    const jar = new Map<string, string>();
    const store = new MapSessionStore<{ userId: string; refreshToken?: string }>();
    const kit = createKit(store);

    await kit.signIn(new FakeHttpContext(jar), { userId: "u2", refreshToken: "rt2" });

    const requestCtx = new FakeHttpContext(jar);
    await kit.middleware()(requestCtx, async () => Promise.resolve());

    const auth = kit.getAuth(requestCtx);
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.principal?.userId).toBe("u2");

    await store.close?.();
  });

  it("signOut_clears_cookie_and_deletes_store", async () => {
    const jar = new Map<string, string>();
    const store = new MapSessionStore<{ userId: string; refreshToken?: string }>();
    const kit = createKit(store);

    const signInCtx = new FakeHttpContext(jar);
    await kit.signIn(signInCtx, { userId: "u3", refreshToken: "rt3" });
    const sid = jar.get("sid") as string;

    const signOutCtx = new FakeHttpContext(jar);
    await kit.signOut(signOutCtx);

    expect(jar.has("sid")).toBe(false);
    expect(signOutCtx.clearedCookies).toContain("sid");
    expect(await store.get(sid)).toBeNull();
    expect(kit.getAuth(signOutCtx).isAuthenticated).toBe(false);

    await store.close?.();
  });

  it("requireAuth_throws_UNAUTHORIZED_when_missing", async () => {
    const kit = createKit(new MapSessionStore());
    const ctx = new FakeHttpContext(new Map());

    await expect(kit.requireAuth()(ctx, async () => Promise.resolve())).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Authentication required.",
    });
  });

  it("refresh_success_updates_payload_and_store", async () => {
    const jar = new Map<string, string>();
    const store = new MapSessionStore<{ userId: string; refreshToken?: string }>();
    let refreshCalls = 0;

    const kit = new SessionKit<{ userId: string; refreshToken?: string }, { userId: string }>({
      store,
      session: { ttlSeconds: 120, rolling: true, renewBeforeSeconds: 10 },
      principalFactory: (payload) => ({ userId: payload.userId }),
      token: {
        shouldRefresh: () => true,
        refresh: async (payload) => {
          refreshCalls += 1;
          return {
            payload: { ...payload, refreshToken: "rt-next" },
            ttlSeconds: 180,
          };
        },
      },
    });

    await kit.signIn(new FakeHttpContext(jar), { userId: "u4", refreshToken: "rt-old" });
    const sid = jar.get("sid") as string;

    const requestCtx = new FakeHttpContext(jar);
    await kit.middleware()(requestCtx, async () => Promise.resolve());

    expect(refreshCalls).toBe(1);
    expect(kit.getAuth(requestCtx).isAuthenticated).toBe(true);

    const stored = await store.get(sid);
    expect(stored?.payload.refreshToken).toBe("rt-next");

    await store.close?.();
  });

  it("refresh_fail_behaviour_unauth_or_revoke", async () => {
    const runCase = async (mode: "unauth" | "revoke") => {
      const jar = new Map<string, string>();
      const store = new MapSessionStore<{ userId: string; refreshToken?: string }>();

      const kit = new SessionKit<{ userId: string; refreshToken?: string }, { userId: string }>({
        store,
        session: { ttlSeconds: 120, rolling: true, renewBeforeSeconds: 10 },
        principalFactory: (payload) => ({ userId: payload.userId }),
        token: {
          shouldRefresh: () => true,
          refresh: async () => {
            throw new Error("refresh failed");
          },
          onRefreshFail: mode,
        },
      });

      await kit.signIn(new FakeHttpContext(jar), { userId: "u5", refreshToken: "rt" });
      const sid = jar.get("sid") as string;

      const requestCtx = new FakeHttpContext(jar);
      await kit.middleware()(requestCtx, async () => Promise.resolve());

      expect(kit.getAuth(requestCtx).isAuthenticated).toBe(false);
      expect(jar.has("sid")).toBe(false);

      const stored = await store.get(sid);
      if (mode === "revoke") {
        expect(stored).toBeNull();
      } else {
        expect(stored).not.toBeNull();
      }

      await store.close?.();
    };

    await runCase("unauth");
    await runCase("revoke");
  });

  it("rolling_renewBeforeSeconds_only_touches_when_near_expiry", async () => {
    type Payload = { userId: string; refreshToken?: string };

    class SpyStore implements SessionStore<Payload> {
      session: StoredSession<Payload> | null = null;
      touchCalls = 0;

      async get(): Promise<StoredSession<Payload> | null> {
        return this.session;
      }

      async set(_sessionId: string, value: StoredSession<Payload>): Promise<void> {
        this.session = value;
      }

      async del(): Promise<void> {
        this.session = null;
      }

      async touch(_sessionId: string, ttlSeconds: number): Promise<void> {
        this.touchCalls += 1;
        if (this.session) {
          this.session = {
            ...this.session,
            expiresAt: Date.now() + ttlSeconds * 1000,
          };
        }
      }
    }

    const jar = new Map<string, string>();
    jar.set("sid", "sid-1");

    const store = new SpyStore();
    const now = Date.now();
    store.session = {
      payload: { userId: "u6", refreshToken: "rt" },
      createdAt: now - 1000,
      expiresAt: now + 90_000,
    };

    const kit = new SessionKit<Payload, { userId: string }>({
      store,
      session: { ttlSeconds: 120, rolling: true, renewBeforeSeconds: 10 },
      principalFactory: (payload) => ({ userId: payload.userId }),
    });

    await kit.middleware()(new FakeHttpContext(jar), async () => Promise.resolve());
    expect(store.touchCalls).toBe(0);

    store.session = {
      ...(store.session as StoredSession<Payload>),
      expiresAt: Date.now() + 5_000,
    };

    await kit.middleware()(new FakeHttpContext(jar), async () => Promise.resolve());
    expect(store.touchCalls).toBe(1);
  });

  it("middleware_throws_SessionKitError_for_unknown_errors", async () => {
    const brokenStore: SessionStore<{ userId: string; refreshToken?: string }> = {
      async get(): Promise<null> {
        throw "boom";
      },
      async set(): Promise<void> {
        throw new Error("unused");
      },
      async del(): Promise<void> {
        throw new Error("unused");
      },
    };

    const kit = createKit(brokenStore);
    const jar = new Map<string, string>();
    jar.set("sid", "sid-err");

    await expect(kit.middleware()(new FakeHttpContext(jar), async () => Promise.resolve())).rejects.toBeInstanceOf(
      SessionKitError,
    );
  });
});
