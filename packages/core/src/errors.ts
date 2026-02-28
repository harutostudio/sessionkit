export type ErrorCode =
    | "UNAUTHORIZED"
    | "INVALID_SESSION"
    | "SESSION_EXPIRED"
    | "STORE_UNAVAILABLE"
    | "INTERNAL_ERROR";

export class SessionKitError extends Error {
    constructor(
        public readonly code: ErrorCode,
        message: string,
        public readonly cause?: unknown
    ) {
        super(message);
        this.name = "SessionKitError";
    }
}

export type ErrorBody = {
    error: {
        code: ErrorCode;
        message: string;
    };
};

export type Logger = {
    debug(msg: string, meta?: unknown): void;
    info(msg: string, meta?: unknown): void;
    warn(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
};

export function defaultErrorBody(code: ErrorCode, message: string): ErrorBody {
    return { error: { code, message } };
}