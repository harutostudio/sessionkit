/**
 * Stable error codes surfaced by SessionKit core and adapters.
 */
export type ErrorCode =
    | "UNAUTHORIZED"
    | "INVALID_SESSION"
    | "SESSION_EXPIRED"
    | "TOKEN_REFRESH_FAILED"
    | "LOCK_TIMEOUT"
    | "STORE_UNAVAILABLE"
    | "INTERNAL_ERROR";

/**
 * Canonical error type used across SessionKit packages.
 */
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

/**
 * JSON-safe error response shape used by adapters.
 */
export type ErrorBody = {
    error: {
        code: ErrorCode;
        message: string;
    };
};

/**
 * Logger contract used by SessionKit core for optional diagnostics.
 */
export type Logger = {
    debug(msg: string, meta?: unknown): void;
    info(msg: string, meta?: unknown): void;
    warn(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
};

/**
 * Creates a normalized error response body.
 */
export function defaultErrorBody(code: ErrorCode, message: string): ErrorBody {
    return { error: { code, message } };
}

/**
 * Type guard for {@link SessionKitError}.
 */
export function isSessionKitError(error: unknown): error is SessionKitError {
    return error instanceof SessionKitError;
}

/**
 * Converts unknown errors into {@link SessionKitError}.
 */
export function toSessionKitError(error: unknown): SessionKitError {
    if (isSessionKitError(error)) {
        return error;
    }

    if (error instanceof Error) {
        return new SessionKitError("INTERNAL_ERROR", error.message, error);
    }

    return new SessionKitError("INTERNAL_ERROR", "Unexpected internal error.", error);
}

/**
 * Maps {@link ErrorCode} to an HTTP status code.
 */
export function statusFromErrorCode(code: ErrorCode): number {
    switch (code) {
        case "UNAUTHORIZED":
        case "INVALID_SESSION":
        case "SESSION_EXPIRED":
        case "TOKEN_REFRESH_FAILED":
            return 401;
        case "STORE_UNAVAILABLE":
        case "LOCK_TIMEOUT":
            return 503;
        case "INTERNAL_ERROR":
        default:
            return 500;
    }
}
