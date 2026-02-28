import { newSessionId } from "../utils/uuid";

export function generateSessionId(): string {
  return newSessionId();
}
