import type { SessionStore, StoredSession } from "../store/SessionStore";

export class SessionManager<TPayload> {
  constructor(private readonly store: SessionStore<TPayload>) {}

  async read(sessionId: string): Promise<StoredSession<TPayload> | null> {
    return this.store.get(sessionId);
  }

  async write(sessionId: string, session: StoredSession<TPayload>, ttlSeconds: number): Promise<void> {
    await this.store.set(sessionId, session, ttlSeconds);
  }

  async destroy(sessionId: string): Promise<void> {
    await this.store.del(sessionId);
  }
}
