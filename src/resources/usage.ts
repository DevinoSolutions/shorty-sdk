import type { HttpClient } from '../core/http'
import type { UsageResponse } from '../types'
import type { RequestOptions } from './common'

/** `client.usage` — the account's plan, subscription, limits, and counters. */
export class UsageResource {
    constructor(private readonly http: HttpClient) {}

    /** GET /v1/usage */
    async get(opts?: RequestOptions): Promise<UsageResponse> {
        const { data } = await this.http.request<UsageResponse>({
            method: 'GET',
            path: '/v1/usage',
            signal: opts?.signal,
            timeoutMs: opts?.timeoutMs,
            headers: opts?.headers,
        })
        return data
    }
}
