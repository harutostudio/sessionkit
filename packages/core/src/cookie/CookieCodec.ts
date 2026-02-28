/**
 * Cookie configuration shared by SessionKit core and adapters.
 */
export type CookieOptions = {
    name?: string; // default "sid"
    path?: string; // default "/"
    domain?: string;
    httpOnly?: boolean; // default true
    secure?: boolean; // default configurable
    sameSite?: "lax" | "strict" | "none"; // default "lax"
    maxAgeSeconds?: number; // optional override
};

function isTokenChar(ch: string): boolean {
    // RFC-ish: keep it simple. We'll percent-encode values anyway.
    return /^[A-Za-z0-9!#$%&'*+\-.^_`|~]$/.test(ch);
}

/**
 * Parses a raw Cookie header into a key/value map.
 */
export function parseCookieHeader(cookieHeader: string | null | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!cookieHeader) return out;

    const parts = cookieHeader.split(";");
    for (const p of parts) {
        const idx = p.indexOf("=");
        if (idx < 0) continue;
        const rawKey = p.slice(0, idx).trim();
        const rawVal = p.slice(idx + 1).trim();
        if (!rawKey) continue;
        try {
            out[rawKey] = decodeURIComponent(rawVal);
        } catch {
            out[rawKey] = rawVal;
        }
    }
    return out;
}

/**
 * Serializes a Set-Cookie header value.
 */
export function serializeSetCookie(
    name: string,
    value: string,
    options: CookieOptions & { maxAgeSeconds?: number }
): string {
    // Basic validation for cookie name
    for (const ch of name) {
        if (!isTokenChar(ch)) throw new Error(`Invalid cookie name: ${name}`);
    }

    const encValue = encodeURIComponent(value);
    const segments: string[] = [`${name}=${encValue}`];

    const path = options.path ?? "/";
    segments.push(`Path=${path}`);

    if (options.domain) segments.push(`Domain=${options.domain}`);
    if (options.httpOnly ?? true) segments.push("HttpOnly");
    if (options.secure) segments.push("Secure");

    const sameSite = options.sameSite ?? "lax";
    segments.push(`SameSite=${sameSite?.[0]?.toUpperCase()}${sameSite.slice(1)}`);

    if (typeof options.maxAgeSeconds === "number") {
        segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`);
    }

    return segments.join("; ");
}

/**
 * Serializes a clearing Set-Cookie header (`Max-Age=0`).
 */
export function serializeClearCookie(name: string, options: CookieOptions): string {
    // Max-Age=0 clears cookie
    return serializeSetCookie(name, "", { ...options, maxAgeSeconds: 0 });
}
