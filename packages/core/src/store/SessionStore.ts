export type StoredSession<TPayload> = {
  payload: TPayload;
  createdAt: number;
  expiresAt: number;
};

export interface SessionStore<TPayload> {
  get(sessionId: string): Promise<StoredSession<TPayload> | null>;
  set(sessionId: string, value: StoredSession<TPayload>, ttlSeconds: number): Promise<void>;
  del(sessionId: string): Promise<void>;
  touch?(sessionId: string, ttlSeconds: number): Promise<void>;
  close?(): Promise<void>;
}
