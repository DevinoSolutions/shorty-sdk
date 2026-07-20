import type { HttpClient } from '../core/http'
import { newIdempotencyKey } from '../core/idempotency'
import type {
    CreateSubtitlesBody,
    JobAccepted,
    SubtitleDownload,
    SubtitleKind,
} from '../types'
import type { RequestOptions, WriteOptions } from './common'

/** Params for `subtitles.download` — pick which artifact kind to fetch. */
export interface DownloadSubtitlesParams extends RequestOptions {
    /** Which artifact to download (srt/vtt/ass/burned). Server default applies. */
    kind?: SubtitleKind
}

/** `client.subtitles` — start captioning jobs and fetch finished artifacts. */
export class SubtitlesResource {
    constructor(private readonly http: HttpClient) {}

    /**
     * POST /v1/subtitles — starts an async job, returns 202 JobAccepted.
     * Auto-generates an Idempotency-Key (reused across retries) unless one is
     * supplied in `opts.idempotencyKey`.
     */
    async create(
        body: CreateSubtitlesBody,
        opts?: WriteOptions,
    ): Promise<JobAccepted> {
        const { data } = await this.http.request<JobAccepted>({
            method: 'POST',
            path: '/v1/subtitles',
            body,
            idempotencyKey: opts?.idempotencyKey ?? newIdempotencyKey(),
            signal: opts?.signal,
            timeoutMs: opts?.timeoutMs,
            headers: opts?.headers,
        })
        return data
    }

    /**
     * GET /v1/subtitles/{jobId}/download — returns a short-lived presigned URL.
     * 409 resource_not_ready (a `ConflictError`) until the job has finished.
     */
    async download(
        jobId: string,
        params?: DownloadSubtitlesParams,
    ): Promise<SubtitleDownload> {
        const { data } = await this.http.request<SubtitleDownload>({
            method: 'GET',
            path: `/v1/subtitles/${encodeURIComponent(jobId)}/download`,
            query: { kind: params?.kind },
            signal: params?.signal,
            timeoutMs: params?.timeoutMs,
            headers: params?.headers,
        })
        return data
    }
}
