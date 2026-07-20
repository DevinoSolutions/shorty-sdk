import type { HttpClient, QueryParams } from '../core/http'
import { newIdempotencyKey } from '../core/idempotency'
import { Page } from '../core/pagination'
import type {
    CreateTranscriptionBody,
    JobAccepted,
    Transcription,
    TranscriptionDetail,
    TranscriptionListResponse,
} from '../types'
import type { RequestOptions, WriteOptions } from './common'

export interface ListTranscriptionsParams {
    limit?: number
    cursor?: string
}

/** `client.transcriptions` — list, fetch, and start transcription jobs. */
export class TranscriptionsResource {
    constructor(private readonly http: HttpClient) {}

    /** GET /v1/transcriptions — cursor-paginated. */
    async list(
        params?: ListTranscriptionsParams,
        opts?: RequestOptions,
    ): Promise<Page<Transcription>> {
        const baseQuery: QueryParams = { limit: params?.limit }
        const fetchPage = async (
            cursor: string | undefined,
        ): Promise<Page<Transcription>> => {
            const { data } = await this.http.request<TranscriptionListResponse>(
                {
                    method: 'GET',
                    path: '/v1/transcriptions',
                    query: { ...baseQuery, cursor },
                    signal: opts?.signal,
                    timeoutMs: opts?.timeoutMs,
                    headers: opts?.headers,
                },
            )
            return new Page<Transcription>(data, fetchPage)
        }
        return fetchPage(params?.cursor)
    }

    /** GET /v1/transcriptions/{id} */
    async get(id: string, opts?: RequestOptions): Promise<TranscriptionDetail> {
        const { data } = await this.http.request<TranscriptionDetail>({
            method: 'GET',
            path: `/v1/transcriptions/${encodeURIComponent(id)}`,
            signal: opts?.signal,
            timeoutMs: opts?.timeoutMs,
            headers: opts?.headers,
        })
        return data
    }

    /**
     * POST /v1/transcriptions — starts an async job, returns 202 JobAccepted.
     * Auto-generates an Idempotency-Key (reused across retries) unless you pass
     * one in `opts.idempotencyKey`.
     */
    async create(
        body: CreateTranscriptionBody,
        opts?: WriteOptions,
    ): Promise<JobAccepted> {
        const { data } = await this.http.request<JobAccepted>({
            method: 'POST',
            path: '/v1/transcriptions',
            body,
            idempotencyKey: opts?.idempotencyKey ?? newIdempotencyKey(),
            signal: opts?.signal,
            timeoutMs: opts?.timeoutMs,
            headers: opts?.headers,
        })
        return data
    }
}
