import { APITimeoutError, JobFailedError } from '../core/errors'
import type { HttpClient } from '../core/http'
import type { JobStatusResponse } from '../types'
import type { RequestOptions } from './common'

/** Normalized terminal/interim job state (mirrors the server's statusFromStream). */
export type NormalizedJobStatus =
    | 'QUEUED'
    | 'PROCESSING'
    | 'SUCCESS'
    | 'ERROR'
    | 'CANCELLED'

/** Map the wire's un-normalized status string to a coarse state. */
export function normalizeJobStatus(raw: unknown): NormalizedJobStatus {
    const s = String(raw ?? 'queued').toLowerCase()
    if (s === 'success' || s === 'completed' || s === 'done') return 'SUCCESS'
    if (s === 'cancelled') return 'CANCELLED'
    if (s === 'error' || s === 'failed' || s === 'missing') return 'ERROR'
    if (s === 'processing' || s === 'running') return 'PROCESSING'
    return 'QUEUED'
}

export interface WaitForOptions {
    /** How often to poll, in ms (default 2000). */
    pollIntervalMs?: number
    /** Overall deadline, in ms (default 600_000). Exceeding it throws APITimeoutError. */
    timeoutMs?: number
    /** Abort the wait early. */
    signal?: AbortSignal
}

/** `client.jobs` — poll async job status; `waitFor` blocks until terminal. */
export class JobsResource {
    constructor(private readonly http: HttpClient) {}

    /** GET /v1/jobs/{id} — the nested camelCase JobStatusResponse. */
    async get(id: string, opts?: RequestOptions): Promise<JobStatusResponse> {
        const { data } = await this.http.request<JobStatusResponse>({
            method: 'GET',
            path: `/v1/jobs/${encodeURIComponent(id)}`,
            signal: opts?.signal,
            timeoutMs: opts?.timeoutMs,
            headers: opts?.headers,
        })
        return data
    }

    /**
     * Convenience poller: polls `get(id)` every `pollIntervalMs` until the job
     * reaches SUCCESS (resolves with the final status), or ERROR/CANCELLED
     * (throws `JobFailedError` carrying the job's `error`). Throws
     * `APITimeoutError` if the deadline elapses. NOT a server feature — this is
     * a client-side loop.
     */
    async waitFor(
        id: string,
        opts?: WaitForOptions,
    ): Promise<JobStatusResponse> {
        const pollIntervalMs = opts?.pollIntervalMs ?? 2000
        const timeoutMs = opts?.timeoutMs ?? 600_000
        const deadline = Date.now() + timeoutMs
        const signal = opts?.signal

        for (;;) {
            const status = await this.get(id, signal ? { signal } : undefined)
            const normalized = normalizeJobStatus(status.status)
            if (normalized === 'SUCCESS') return status
            if (normalized === 'ERROR' || normalized === 'CANCELLED') {
                throw new JobFailedError({
                    jobId: status.jobId || id,
                    status: status.status,
                    error: status.error ?? null,
                })
            }
            if (Date.now() + pollIntervalMs > deadline) {
                throw new APITimeoutError(
                    `Timed out waiting for job ${id} after ${timeoutMs}ms.`,
                )
            }
            await sleep(pollIntervalMs, signal)
        }
    }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
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
