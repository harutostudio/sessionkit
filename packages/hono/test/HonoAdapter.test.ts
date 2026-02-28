import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { SessionKitError, type HttpMiddleware } from "@sessionkit/core";
import { toHonoMiddleware } from "../src";

const unauthorizedMiddleware: HttpMiddleware = async () => {
  throw new SessionKitError("UNAUTHORIZED", "Authentication required.");
};

describe("HonoAdapter", () => {
  it("maps UNAUTHORIZED to default JSON response", async () => {
    const app = new Hono();

    app.use("/me", toHonoMiddleware(unauthorizedMiddleware));
    app.get("/me", (c) => c.json({ ok: true }));

    const res = await app.request("http://localhost/me");
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required.",
      },
    });
  });

  it("supports onError override", async () => {
    const app = new Hono();

    app.use(
      "/me",
      toHonoMiddleware(unauthorizedMiddleware, {
        onError(_error, c) {
          return c.redirect("/login", 302);
        },
      }),
    );
    app.get("/me", (c) => c.json({ ok: true }));

    const res = await app.request("http://localhost/me", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("appends multiple Set-Cookie values", async () => {
    const app = new Hono();

    app.use(
      "/cookie",
      toHonoMiddleware(async (ctx, next) => {
        ctx.setCookie("sid", "token-1", { path: "/", httpOnly: true });
        ctx.clearCookie("sid", { path: "/", httpOnly: true });
        await next();
      }),
    );
    app.get("/cookie", (c) => c.text("ok"));

    const res = await app.request("http://localhost/cookie");
    const setCookie = res.headers.get("set-cookie") ?? "";

    expect(setCookie).toContain("sid=token-1");
    expect(setCookie).toContain("Max-Age=0");
  });
});
