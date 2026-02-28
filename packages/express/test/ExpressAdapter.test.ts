import { describe, expect, it, vi } from "vitest";
import { SessionKitError, type HttpMiddleware } from "@sessionkit/core";
import { createExpressHttpContext, toExpressMiddleware } from "../src";

type Req = {
  headers: Record<string, string | string[] | undefined>;
  auth?: unknown;
};

type Res = {
  statusCode: number;
  body: unknown;
  headers: Record<string, unknown>;
  status: (code: number) => void;
  json: (body: unknown) => void;
  getHeader: (name: string) => unknown;
  setHeader: (name: string, value: unknown) => void;
};

function createReqRes(): { req: Req; res: Res } {
  const headers: Record<string, unknown> = {};
  const res: Res = {
    statusCode: 200,
    body: null,
    headers,
    status(code: number): void {
      this.statusCode = code;
    },
    json(body: unknown): void {
      this.body = body;
    },
    getHeader(name: string): unknown {
      return headers[name.toLowerCase()];
    },
    setHeader(name: string, value: unknown): void {
      headers[name.toLowerCase()] = value;
    },
  };

  return {
    req: { headers: {} },
    res,
  };
}

const unauthorizedMiddleware: HttpMiddleware = async () => {
  throw new SessionKitError("UNAUTHORIZED", "Authentication required.");
};

describe("ExpressAdapter", () => {
  it("maps UNAUTHORIZED to default JSON response", async () => {
    const middleware = toExpressMiddleware(unauthorizedMiddleware);
    const { req, res } = createReqRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required.",
      },
    });
  });

  it("supports onError override", async () => {
    const middleware = toExpressMiddleware(unauthorizedMiddleware, {
      onError(error, _req, res): void {
        expect(error.code).toBe("UNAUTHORIZED");
        res.status(302);
        res.json({ redirect: "/login" });
      },
    });

    const { req, res } = createReqRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(302);
    expect(res.body).toEqual({ redirect: "/login" });
  });

  it("appends multiple Set-Cookie values", () => {
    const { req, res } = createReqRes();
    const ctx = createExpressHttpContext(req, res);

    ctx.setCookie("sid", "token-1", { path: "/", httpOnly: true });
    ctx.clearCookie("sid", { path: "/", httpOnly: true });

    const setCookie = res.getHeader("set-cookie");
    expect(Array.isArray(setCookie)).toBe(true);
    const values = setCookie as string[];
    expect(values).toHaveLength(2);
    expect(values[0]).toContain("sid=token-1");
    expect(values[1]).toContain("Max-Age=0");
  });
});
