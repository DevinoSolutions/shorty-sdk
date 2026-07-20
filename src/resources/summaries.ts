import type { HttpClient } from '../core/http'
import { newIdempotencyKey } from '../core/idempotency'
import type { CreateSummaryBody, JobAccepted } from '../types'
import type { WriteOptions } from './common'

/** `client.summaries` — start summarization jobs (youtube / url / text). */
export class SummariesResource {
    constructor(private readonly http: HttpClient) {}

    /**
     * POST /v1/summaries — starts an async job, returns 202 JobAccepted. The
     * body is discriminated on `source` (`youtube` | `url` | `text`).
     * Auto-generates an Idempotency-Key (reused across retries) unless one is
     * supplied in `opts.idempotencyKey`.
     */
    async create(
        body: CreateSummaryBody,
        opts?: WriteOptions,
    ): Promise<JobAccepted> {
        const { data } = await this.http.request<JobAccepted>({
            method: 'POST',
            path: '/v1/summaries',
            body,
            idempotencyKey: opts?.idempotencyKey ?? newIdempotencyKey(),
            signal: opts?.signal,
            timeoutMs: opts?.timeoutMs,
            headers: opts?.headers,
        })
        return data
    }
}
