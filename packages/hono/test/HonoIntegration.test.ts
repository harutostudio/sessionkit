import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { MapSessionStore, SessionKit } from "@sessionkit/core";
import { createHonoHttpContext, toHonoMiddleware } from "../src";

function createApp() {
  const store = new MapSessionStore<{ userId: string }>();
  const kit = new SessionKit<{ userId: string }, { userId: string }>({
    store,
    session: { ttlSeconds: 120, rolling: true, renewBeforeSeconds: 10 },
    principalFactory: (payload) => ({ userId: payload.userId }),
  });

  const app = new Hono();
  app.use("*", toHonoMiddleware(kit.middleware()));

  app.post("/login", async (c) => {
    const ctx = createHonoHttpContext(c);
    const result = await kit.signIn(ctx, { userId: "u-int" });
    return c.json({ ok: true, me: result.principal });
  });

  app.get("/me", toHonoMiddleware(kit.requireAuth()), (c) => {
    const ctx = createHonoHttpContext(c);
    const auth = kit.getAuth(ctx);
    return c.json({ me: auth.principal });
  });

  app.post("/logout", async (c) => {
    const ctx = createHonoHttpContext(c);
    await kit.signOut(ctx);
    return c.json({ ok: true });
  });

  app.get("/cookie-twice", (c) => {
    const ctx = createHonoHttpContext(c);
    ctx.setCookie("sid", "abc", { path: "/", httpOnly: true });
    ctx.clearCookie("sid", { path: "/", httpOnly: true });
    return c.json({ ok: true });
  });

  return app;
}

describe("Hono integration", () => {
  it("supports login -> me -> logout flow", async () => {
    const app = createApp();

    const meBefore = await app.request("http://localhost/me");
    expect(meBefore.status).toBe(401);

    const login = await app.request("http://localhost/login", { method: "POST" });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie") ?? "";

    const meAfter = await app.request("http://localhost/me", {
      headers: { cookie },
    });
    expect(meAfter.status).toBe(200);
    await expect(meAfter.json()).resolves.toEqual({ me: { userId: "u-int" } });

    const logout = await app.request("http://localhost/logout", {
      method: "POST",
      headers: { cookie },
    });
    expect(logout.status).toBe(200);

    const meAfterLogout = await app.request("http://localhost/me", {
      headers: { cookie },
    });
    expect(meAfterLogout.status).toBe(401);
  });

  it("appends set-cookie headers in same response", async () => {
    const app = createApp();
    const res = await app.request("http://localhost/cookie-twice");

    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sid=abc");
    expect(setCookie).toContain("Max-Age=0");
  });
});
