import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { MapSessionStore, SessionKit } from "@sessionkit/core";
import { createExpressHttpContext, toExpressMiddleware } from '../src/index.ts';

let server;

afterEach(async () => {
  if (!server) {
    return;
  }
  await new Promise((resolve) => server.close(resolve));
  server = undefined;
});

function createApp() {
  const store = new MapSessionStore();
  const kit = new SessionKit({
    store,
    session: { ttlSeconds: 120, rolling: true, renewBeforeSeconds: 10 },
    principalFactory: (payload) => ({ userId: payload.userId }),
  });

  return { store, kit };
}

async function startExpress(kit) {
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());

  app.use(toExpressMiddleware(kit.middleware()));

  app.post("/login", async (req, res, next) => {
    try {
      const ctx = createExpressHttpContext(req, res);
      const result = await kit.signIn(ctx, { userId: req.body?.userId ?? "u1" });
      res.status(200).json({ ok: true, me: result.principal });
    } catch (error) {
      next(error);
    }
  });

  app.get("/me", toExpressMiddleware(kit.requireAuth()), (req, res) => {
    const ctx = createExpressHttpContext(req, res);
    const auth = kit.getAuth(ctx);
    res.status(200).json({ me: auth.principal });
  });

  app.post("/logout", async (req, res, next) => {
    try {
      const ctx = createExpressHttpContext(req, res);
      await kit.signOut(ctx);
      res.status(200).json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get("/cookie-twice", (_req, res) => {
    const ctx = createExpressHttpContext(_req, res);
    ctx.setCookie("sid", "abc", { path: "/", httpOnly: true });
    ctx.clearCookie("sid", { path: "/", httpOnly: true });
    res.status(200).json({ ok: true });
  });

  server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return `http://127.0.0.1:${port}`;
}

const describeExpress = process.env.CODEX_SANDBOX === "seatbelt" ? describe.skip : describe;

describeExpress("Express integration", () => {
  it("supports login -> me -> logout flow", async () => {
    const { kit } = createApp();
    const baseUrl = await startExpress(kit);

    const meBefore = await fetch(`${baseUrl}/me`);
    expect(meBefore.status).toBe(401);

    const login = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "u-int" }),
    });
    expect(login.status).toBe(200);

    const cookie = login.headers.get("set-cookie");
    expect(cookie).toBeTruthy();

    const meAfter = await fetch(`${baseUrl}/me`, {
      headers: { cookie: cookie ?? "" },
    });
    expect(meAfter.status).toBe(200);
    await expect(meAfter.json()).resolves.toEqual({ me: { userId: "u-int" } });

    const logout = await fetch(`${baseUrl}/logout`, {
      method: "POST",
      headers: { cookie: cookie ?? "" },
    });
    expect(logout.status).toBe(200);

    const meAfterLogout = await fetch(`${baseUrl}/me`, {
      headers: { cookie: cookie ?? "" },
    });
    expect(meAfterLogout.status).toBe(401);
  });

  it("appends set-cookie headers in same response", async () => {
    const { kit } = createApp();
    const baseUrl = await startExpress(kit);

    const res = await fetch(`${baseUrl}/cookie-twice`);
    expect(res.status).toBe(200);

    const values = typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);

    expect(values.length).toBeGreaterThanOrEqual(2);
    expect(values.some((v) => v.includes("sid=abc"))).toBe(true);
    expect(values.some((v) => v.includes("Max-Age=0"))).toBe(true);
  });
});
