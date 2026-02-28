import type { SessionStore, StoredSession } from "./SessionStore";

type Entry<T> = { value: StoredSession<T>; expiresAt: number };

export class MapSessionStore<TPayload> implements SessionStore<TPayload> {
    private readonly map = new Map<string, Entry<TPayload>>();
    private readonly cleanupTimer: NodeJS.Timeout | null;

    constructor(
        private readonly options?: {
            cleanupIntervalSeconds?: number; // default 60
            maxSize?: number; // optional safety
        }
    ) {
        const interval = (options?.cleanupIntervalSeconds ?? 60) * 1000;
        this.cleanupTimer = setInterval(() => this.cleanup(), interval);
        this.cleanupTimer.unref?.();
    }

    async get(sessionId: string): Promise<StoredSession<TPayload> | null> {
        const e = this.map.get(sessionId);
        if (!e) return null;

        if (Date.now() >= e.expiresAt) {
            this.map.delete(sessionId);
            return null;
        }
        return e.value;
    }

    async set(sessionId: string, value: StoredSession<TPayload>, ttlSeconds: number): Promise<void> {
        if (this.options?.maxSize && this.map.size >= this.options.maxSize) {
            this.cleanup();
            if (this.map.size >= this.options.maxSize) {
                const firstKey = this.map.keys().next().value as string | undefined;
                if (firstKey) this.map.delete(firstKey);
            }
        }

        const expiresAt = Date.now() + ttlSeconds * 1000;
        this.map.set(sessionId, { value, expiresAt });
    }

    async del(sessionId: string): Promise<void> {
        this.map.delete(sessionId);
    }

    async touch(sessionId: string, ttlSeconds: number): Promise<void> {
        const e = this.map.get(sessionId);
        if (!e) return;

        const now = Date.now();
        const expiresAt = now + ttlSeconds * 1000;

        e.expiresAt = expiresAt;
        e.value = { ...e.value, expiresAt };
        this.map.set(sessionId, e);
    }

    async close(): Promise<void> {
        if (this.cleanupTimer) clearInterval(this.cleanupTimer);
        this.map.clear();
    }

    private cleanup(): void {
        const now = Date.now();
        for (const [k, e] of this.map.entries()) {
            if (now >= e.expiresAt) this.map.delete(k);
        }
    }
}
