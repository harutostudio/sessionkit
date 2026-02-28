import { randomUUID } from "crypto";

export function newSessionId(): string {
    return randomUUID();
}