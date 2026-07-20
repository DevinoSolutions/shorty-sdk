// The request / retry / backoff engine. The money path — reviewed line by line.
//
// Retry policy (see README "Retries"):
//   Retryable: connection errors · per-attempt timeout · 408 · 429 rate_limited
//   (or 429 with no parseable code) · 500/502/503/504.
//   NEVER: 429 quota_exhausted · any other 4xx · caller-signal aborts.
//   POST is retried ONLY when it carries an Idempotency-Key (the same key across
//   every attempt). Delay: Retry-After honored (delta-seconds AND HTTP-date,
//   capped 60s); else full-jitter backoff random(0, min(0.5*2^attempt, 8))s.
//   Timeout is PER ATTEMPT (an AbortController per try, linked to the caller's
//   signal). A caller abort surfaces as the caller's abort, not APITimeoutError.

import type { ProblemBody } from '../types'
import {
    APIConnectionError,
    APIError,
    APITimeoutError,
    QuotaExhaustedError,
    RateLimitError,
    createApiError,
    parseRetryAfterSeconds,
} from './errors'
import { redact } from './redaction'
import { cappedRetryAfterMs, fullJitterBackoffMs } from './retryPolicy'

export type FetchLike = typeof fetch

export type QueryValue = string | number | boolean | undefined
export type QueryParams = Record<string, QueryValue>

export interface HttpConfig {
    baseUrl: string
    apiKey: string
    fetchImpl: FetchLike
    timeoutMs: number
    maxRetries: number
    userAgent: string
    /** Already-redacting sink; called with method/path/status/attempt/request-id only. */
    debug: ((message: string) => void) | undefined
}

export interface HttpRequest {
    method: string
    path: string
    query?: QueryParams | undefined
    body?: unknown
    headers?: Record<string, string> | undefined
    idempotencyKey?: string | undefined
    signal?: AbortSignal | undefined
    timeoutMs?: number | undefined
}

export interface HttpResponse<T> {
    data: T
    response: Response
}

const RETRYABLE_5XX = new Set([500, 502, 503, 504])

export class HttpClient {
    private readonly config: HttpConfig

    constructor(config: HttpConfig) {
        this.config = config
    }

    async request<T>(req: HttpRequest): Promise<HttpResponse<T>> {
        const maxRetries = this.config.maxRetries
        let attempt = 0
        for (;;) {
            try {
                return await this.attempt<T>(req, attempt)
            } catch (err) {
                const retryable = this.isRetryable(err, req)
                if (!retryable || attempt >= maxRetries) throw err
                const delayMs = this.computeDelayMs(err, attempt)
                this.log(req, `retry in ${delayMs}ms`, attempt)
                await abortableSleep(delayMs, req.signal)
                attempt += 1
            }
        }
    }

    private async attempt<T>(
        req: HttpRequest,
        attempt: number,
    ): Promise<HttpResponse<T>> {
        const url = this.buildUrl(req.path, req.query)
        const controller = new AbortController()
        const timeoutMs = req.timeoutMs ?? this.config.timeoutMs

        // Link the caller's signal so a caller abort cancels this attempt.
        const caller = req.signal
        const onCallerAbort = () => controller.abort(caller?.reason)
        if (caller) {
            if (caller.aborted) controller.abort(caller.reason)
            else caller.addEventListener('abort', onCallerAbort, { once: true })
        }

        let timedOut = false
        const timer = setTimeout(() => {
            timedOut = true
            controller.abort()
        }, timeoutMs)

        let response: Response
        try {
            response = await this.config.fetchImpl(url, {
                method: req.method,
                headers: this.buildHeaders(req),
                body:
                    req.body === undefined
                        ? undefined
                        : JSON.stringify(req.body),
                signal: controller.signal,
            })
        } catch (err) {
            // A caller abort wins over an SDK timeout: re-surface the caller's
            // reason unchanged (never converted to APITimeoutError, never retried).
            if (caller?.aborted) throw caller.reason ?? err
            if (timedOut) throw new APITimeoutError()
            throw new APIConnectionError('Connection error.', { cause: err })
        } finally {
            clearTimeout(timer)
            if (caller) caller.removeEventListener('abort', onCallerAbort)
        }

        const headers = headersToRecord(response.headers)
        const requestId = headers['request-id']

        if (response.ok) {
            this.log(req, `${response.status}`, attempt, requestId)
            const data = (await parseJsonSafe(response)) as T
            return { data, response }
        }

        const { problem, rawText } = await readErrorBody(response)
        const error = createApiError({
            status: response.status,
            problem,
            rawText,
            headers,
            fallbackRequestId: requestId,
        })
        this.log(
            req,
            `${response.status} ${error.code ?? ''}`,
            attempt,
            requestId,
        )
        throw error
    }

    private isRetryable(err: unknown, req: HttpRequest): boolean {
        // Caller aborts and everything non-ours: never retry.
        if (isAbortError(err)) return false

        // POST is only retry-safe with an idempotency key (same key reused).
        const unsafeWithoutKey =
            req.method.toUpperCase() === 'POST' &&
            req.idempotencyKey === undefined
        if (unsafeWithoutKey) return false

        if (err instanceof APITimeoutError) return true
        if (err instanceof APIConnectionError) return true
        if (err instanceof QuotaExhaustedError) return false // D4 payoff
        if (err instanceof RateLimitError) return true
        if (err instanceof APIError) {
            if (err.status === 408) return true
            if (RETRYABLE_5XX.has(err.status)) return true
            return false
        }
        return false
    }

    private computeDelayMs(err: unknown, attempt: number): number {
        if (err instanceof APIError) {
            const retryAfterMs = retryAfterFromHeaders(err.headers)
            if (retryAfterMs !== undefined)
                return cappedRetryAfterMs(retryAfterMs)
        }
        return fullJitterBackoffMs(attempt)
    }

    private buildUrl(path: string, query: QueryParams | undefined): string {
        const url = new URL(path, ensureTrailingBase(this.config.baseUrl))
        if (query) {
            for (const [key, value] of Object.entries(query)) {
                if (value === undefined) continue
                url.searchParams.set(key, String(value))
            }
        }
        return url.toString()
    }

    private buildHeaders(req: HttpRequest): Record<string, string> {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.config.apiKey}`,
            Accept: 'application/json',
            'User-Agent': this.config.userAgent,
            // Twin for environments that forbid overriding User-Agent.
            'X-Shorty-SDK': this.config.userAgent,
        }
        if (req.body !== undefined) {
            headers['Content-Type'] = 'application/json'
        }
        if (req.idempotencyKey !== undefined) {
            headers['Idempotency-Key'] = req.idempotencyKey
        }
        if (req.headers) {
            for (const [k, v] of Object.entries(req.headers)) headers[k] = v
        }
        return headers
    }

    private log(
        req: HttpRequest,
        outcome: string,
        attempt: number,
        requestId?: string,
    ): void {
        if (!this.config.debug) return
        const msg =
            `${req.method} ${req.path} -> ${outcome} ` +
            `[attempt ${attempt}]` +
            (requestId ? ` req=${requestId}` : '')
        this.config.debug(redact(msg))
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function ensureTrailingBase(baseUrl: string): string {
    return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

function headersToRecord(headers: Headers): Record<string, string> {
    const record: Record<string, string> = {}
    headers.forEach((value, key) => {
        record[key.toLowerCase()] = value
    })
    return record
}

function retryAfterFromHeaders(
    headers: Record<string, string>,
): number | undefined {
    const raw = headers['retry-after']
    if (raw === undefined) return undefined
    const seconds = parseRetryAfterSeconds(raw)
    return seconds === undefined ? undefined : seconds * 1000
}

async function parseJsonSafe(response: Response): Promise<unknown> {
    const text = await response.text()
    if (text.trim() === '') return undefined
    return JSON.parse(text)
}

async function readErrorBody(
    response: Response,
): Promise<{ problem: ProblemBody | undefined; rawText: string | undefined }> {
    let text: string
    try {
        text = await response.text()
    } catch {
        return { problem: undefined, rawText: undefined }
    }
    if (text.trim() === '') return { problem: undefined, rawText: undefined }
    try {
        const parsed: unknown = JSON.parse(text)
        if (isProblemBody(parsed)) return { problem: parsed, rawText: text }
        return { problem: undefined, rawText: text }
    } catch {
        return { problem: undefined, rawText: text }
    }
}

function isProblemBody(value: unknown): value is ProblemBody {
    if (typeof value !== 'object' || value === null) return false
    const v = value as Record<string, unknown>
    // A problem body always carries a machine `code` and a human `title`.
    return typeof v.code === 'string' && typeof v.title === 'string'
}

function isAbortError(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        (err as { name?: unknown }).name === 'AbortError'
    )
}

/** A sleep that rejects with the signal's reason if the caller aborts mid-wait. */
function abortableSleep(
    ms: number,
    signal: AbortSignal | undefined,
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
            return
        }
        const timer = setTimeout(() => {
            cleanup()
            resolve()
        }, ms)
        const onAbort = () => {
            cleanup()
            reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        const cleanup = () => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
        }
        signal?.addEventListener('abort', onAbort, { once: true })
    })
}
