import type { StoredSession } from "../store/SessionStore";

export function serializeSession<TPayload>(value: StoredSession<TPayload>): string {
  return JSON.stringify(value);
}

export function deserializeSession<TPayload>(raw: string): StoredSession<TPayload> {
  return JSON.parse(raw) as StoredSession<TPayload>;
}
