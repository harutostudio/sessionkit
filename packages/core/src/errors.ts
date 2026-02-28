export type ErrorCode =
    | "UNAUTHORIZED"
    | "INVALID_SESSION"
    | "SESSION_EXPIRED"
    | "LOCK_TIMEOUT"
    | "STORE_UNAVAILABLE"
    | "INTERNAL_ERROR";

export class SessionKitError extends Error {
    readonly details: Record<string, unknown> | undefined;

    constructor(
        public readonly code: ErrorCode,
        message: string,
        public readonly cause?: unknown,
        details?: Record<string, unknown>
    ) {
        super(message);
        this.name = "SessionKitError";
        this.details = details;
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

export function isSessionKitError(error: unknown): error is SessionKitError {
    return error instanceof SessionKitError;
}

export function toSessionKitError(error: unknown): SessionKitError {
    if (isSessionKitError(error)) {
        return error;
    }

    if (error instanceof Error) {
        return new SessionKitError("INTERNAL_ERROR", error.message, error);
    }

    return new SessionKitError("INTERNAL_ERROR", "Unexpected internal error.", error);
}

export function statusFromErrorCode(code: ErrorCode): number {
    switch (code) {
        case "UNAUTHORIZED":
        case "INVALID_SESSION":
        case "SESSION_EXPIRED":
            return 401;
        case "STORE_UNAVAILABLE":
        case "LOCK_TIMEOUT":
            return 503;
        case "INTERNAL_ERROR":
        default:
            return 500;
    }
}
