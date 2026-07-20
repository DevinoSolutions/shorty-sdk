// The typed RFC 9457 error hierarchy. Mapping is code-driven first (the 15-code
// registry from the server's problemCodes.ts), with a status-class fallback so
// an UNKNOWN future `code` never throws the mapper — it maps by status instead
// (forward-compat). Every `.message` is `title: detail (request_id)` and NEVER
// contains the API key.

import type { FieldError, ProblemBody } from '../types'
import { redact } from './redaction'

/** Base class for every error this SDK throws. */
export class ShortyError extends Error {
    constructor(message: string, options?: { cause?: unknown }) {
        super(message)
        this.name = new.target.name
        if (options?.cause !== undefined) {
            // Preserve the underlying cause for debugging (network/DNS errors).
            ;(this as { cause?: unknown }).cause = options.cause
        }
        // Restore prototype chain across the TS -> ES target down-level.
        Object.setPrototypeOf(this, new.target.prototype)
    }
}

/** A transport-level failure (DNS, connection refused, TLS). `cause` is kept. */
export class APIConnectionError extends ShortyError {
    constructor(message = 'Connection error.', options?: { cause?: unknown }) {
        super(message, options)
    }
}

/** A per-attempt timeout elapsed (the request was aborted by the SDK deadline). */
export class APITimeoutError extends APIConnectionError {
    constructor(message = 'Request timed out.') {
        super(message)
    }
}

/** A polled job ended in ERROR/CANCELLED (thrown only by `jobs.waitFor`). */
export class JobFailedError extends ShortyError {
    readonly jobId: string
    /** The un-normalized terminal status string (e.g. 'error', 'cancelled'). */
    readonly status: string
    /** The job's own error message, if any. */
    readonly jobError: string | null

    constructor(input: {
        jobId: string
        status: string
        error: string | null
    }) {
        super(
            `Job ${input.jobId} ended in status "${input.status}"` +
                (input.error ? `: ${input.error}` : ''),
        )
        this.jobId = input.jobId
        this.status = input.status
        this.jobError = input.error
    }
}

/** Fields shared by every HTTP-level (non-2xx) error. */
export interface APIErrorInit {
    status: number
    code: string | undefined
    problemType: string | undefined
    title: string
    detail: string | undefined
    requestId: string | undefined
    errors: FieldError[] | undefined
    headers: Record<string, string>
    retryAfterSeconds: number | undefined
}

/** Any non-2xx response. Subclasses below are chosen by code, then status. */
export class APIError extends ShortyError {
    readonly status: number
    readonly code: string | undefined
    readonly problemType: string | undefined
    readonly title: string
    readonly detail: string | undefined
    readonly requestId: string | undefined
    readonly errors: FieldError[] | undefined
    readonly headers: Record<string, string>
    readonly retryAfterSeconds: number | undefined

    constructor(init: APIErrorInit) {
        super(APIError.buildMessage(init))
        this.status = init.status
        this.code = init.code
        this.problemType = init.problemType
        this.title = init.title
        this.detail = init.detail
        this.requestId = init.requestId
        this.errors = init.errors
        this.headers = init.headers
        this.retryAfterSeconds = init.retryAfterSeconds
    }

    private static buildMessage(init: APIErrorInit): string {
        const base = init.detail ? `${init.title}: ${init.detail}` : init.title
        const withId = init.requestId ? `${base} (${init.requestId})` : base
        return redact(withId)
    }
}

export class AuthenticationError extends APIError {}
export class PermissionDeniedError extends APIError {}
export class NotFoundError extends APIError {}
export class ConflictError extends APIError {}
export class ValidationError extends APIError {}
export class APIServerError extends APIError {}

export class RateLimitError extends APIError {}
/** 429 quota_exhausted — a period allowance is spent; NOT retryable. */
export class QuotaExhaustedError extends APIError {}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/** Code -> subclass (the primary mapping; the 15-code registry). */
const CODE_TO_CLASS: Record<string, new (init: APIErrorInit) => APIError> = {
    unauthorized: AuthenticationError,
    invalid_api_key: AuthenticationError,
    insufficient_scope: PermissionDeniedError,
    feature_not_enabled: PermissionDeniedError,
    resource_not_found: NotFoundError,
    idempotency_conflict: ConflictError,
    idempotency_in_progress: ConflictError,
    resource_not_ready: ConflictError,
    validation_failed: ValidationError,
    idempotency_key_reused: ValidationError,
    request_too_large: ValidationError,
    rate_limited: RateLimitError,
    quota_exhausted: QuotaExhaustedError,
    internal_error: APIServerError,
    service_unavailable: APIServerError,
}

/** Status class -> subclass (fallback when the code is missing/unknown). */
function classByStatus(status: number): new (init: APIErrorInit) => APIError {
    switch (status) {
        case 401:
            return AuthenticationError
        case 403:
            return PermissionDeniedError
        case 404:
            return NotFoundError
        case 409:
            return ConflictError
        case 400:
        case 413:
        case 422:
            return ValidationError
        case 429:
            // Unknown/absent code at 429 -> treat as a plain rate limit
            // (retryable). quota_exhausted only ever comes from the code map.
            return RateLimitError
        default:
            if (status >= 500) return APIServerError
            return APIError
    }
}

/**
 * Build the right APIError subclass from a parsed problem body (or a raw
 * non-JSON snippet). By `code` first; by status class when code is absent or
 * unknown. Never throws — an unknown code silently falls through to status.
 */
export function createApiError(input: {
    status: number
    problem: ProblemBody | undefined
    rawText: string | undefined
    headers: Record<string, string>
    fallbackRequestId: string | undefined
}): APIError {
    const { status, problem, rawText, headers, fallbackRequestId } = input

    const code = problem?.code
    const Ctor =
        (code !== undefined ? CODE_TO_CLASS[code] : undefined) ??
        classByStatus(status)

    const requestId =
        problem?.request_id ?? headers['request-id'] ?? fallbackRequestId

    // Non-JSON body (proxy 502 HTML, Cloudflare): fold a bounded, redacted
    // snippet into `detail` so the failure is still legible.
    const snippet =
        problem === undefined && rawText !== undefined && rawText.trim() !== ''
            ? redact(rawText.slice(0, 500))
            : undefined

    const retryAfterSeconds = parseRetryAfterSeconds(headers['retry-after'])

    return new Ctor({
        status,
        code,
        problemType: problem?.type,
        title: problem?.title ?? `HTTP ${status}`,
        detail: problem?.detail ?? snippet,
        requestId,
        errors: problem?.errors,
        headers,
        retryAfterSeconds,
    })
}

/** Parse a Retry-After header value (delta-seconds or HTTP-date) into seconds. */
export function parseRetryAfterSeconds(
    value: string | undefined,
    now: number = Date.now(),
): number | undefined {
    if (value === undefined) return undefined
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    const asNumber = Number(trimmed)
    if (Number.isFinite(asNumber)) return Math.max(0, Math.round(asNumber))
    const asDate = Date.parse(trimmed)
    if (!Number.isNaN(asDate))
        return Math.max(0, Math.ceil((asDate - now) / 1000))
    return undefined
}
