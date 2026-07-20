// The Shorty client. Holds the API key in a CLOSURE (passed to the HttpClient),
// never as an enumerable instance field — so `JSON.stringify(client)` and
// `util.inspect(client)` cannot leak it. A custom inspect + toJSON make that
// explicit and pin it in tests.

import type { FetchLike, HttpRequest, HttpResponse } from './core/http'
import { HttpClient } from './core/http'
import { redact } from './core/redaction'
import { ArticlesResource } from './resources/articles'
import { JobsResource } from './resources/jobs'
import { SubtitlesResource } from './resources/subtitles'
import { SummariesResource } from './resources/summaries'
import { TranscriptionsResource } from './resources/transcriptions'
import { UsageResource } from './resources/usage'
import { VERSION } from './version'

const DEFAULT_BASE_URL = 'https://aishorty.com'
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_RETRIES = 2

export interface ShortyOptions {
    /**
     * Your `shk_live_...` API key. Falls back to `process.env.SHORTY_API_KEY`.
     * The constructor throws if neither is set.
     */
    apiKey?: string
    /** API origin. Default `https://aishorty.com` (paths already include `/v1`). */
    baseUrl?: string
    /** Per-attempt timeout in ms (default 60000). */
    timeoutMs?: number
    /** Retries after the first attempt (default 2). */
    maxRetries?: number
    /** Override the fetch implementation (tests, proxies, custom agents). */
    fetch?: FetchLike
    /**
     * Debug logging. `true` logs method/path/status/attempt/request-id to
     * stderr; a function receives the same (already-redacted) strings. Never
     * logs headers or bodies.
     */
    debug?: boolean | ((message: string) => void)
    /**
     * Allow construction in a browser-like environment. Default false: the
     * constructor throws when `window` is defined, because a secret API key must
     * not ship to a browser. Set true only if you have a deliberate proxy setup.
     */
    dangerouslyAllowBrowser?: boolean
}

/** Options for the raw `client.request` escape hatch. */
export interface RawRequestOptions {
    method: string
    path: string
    query?: HttpRequest['query']
    body?: unknown
    headers?: Record<string, string>
    /** POSTs with a key are retry-safe; without one they are never retried. */
    idempotencyKey?: string
    signal?: AbortSignal
    timeoutMs?: number
}

export class Shorty {
    readonly usage: UsageResource
    readonly articles: ArticlesResource
    readonly transcriptions: TranscriptionsResource
    readonly summaries: SummariesResource
    readonly subtitles: SubtitlesResource
    readonly jobs: JobsResource

    /** The resolved base URL (safe to expose — no secret). */
    readonly baseUrl: string

    // Held here only to drive the escape hatch; the key lives in the closure
    // captured by HttpClient's config, not on this instance.
    private readonly http: HttpClient

    constructor(options: ShortyOptions = {}) {
        const apiKey = options.apiKey ?? process.env.SHORTY_API_KEY
        if (!apiKey) {
            throw new Error(
                'Missing Shorty API key. Pass `new Shorty({ apiKey })` or set ' +
                    'the SHORTY_API_KEY environment variable.',
            )
        }

        const hasWindow =
            typeof (globalThis as { window?: unknown }).window !== 'undefined'
        if (!options.dangerouslyAllowBrowser && hasWindow) {
            throw new Error(
                'Shorty was constructed in a browser-like environment. Your ' +
                    'API key is a secret and must stay server-side. If you have ' +
                    'a deliberate proxy setup, pass `dangerouslyAllowBrowser: true`.',
            )
        }

        this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL

        const rawDebug = options.debug
        const debug =
            rawDebug === true
                ? (message: string) => {
                      // eslint sink: stderr, redacted at source in HttpClient.
                      process.stderr.write(`[shorty] ${redact(message)}\n`)
                  }
                : typeof rawDebug === 'function'
                  ? (message: string) => rawDebug(redact(message))
                  : undefined

        this.http = new HttpClient({
            baseUrl: this.baseUrl,
            apiKey,
            fetchImpl: options.fetch ?? globalThis.fetch,
            timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
            userAgent: `aishorty-sdk/${VERSION} node/${process.version}`,
            debug,
        })

        this.usage = new UsageResource(this.http)
        this.articles = new ArticlesResource(this.http)
        this.transcriptions = new TranscriptionsResource(this.http)
        this.summaries = new SummariesResource(this.http)
        this.subtitles = new SubtitlesResource(this.http)
        this.jobs = new JobsResource(this.http)
    }

    /**
     * Raw escape hatch for undocumented paths. Same retry rules apply; a POST
     * without an `idempotencyKey` is never retried. Returns both the decoded
     * body and the raw `Response`.
     */
    async request<T = unknown>(
        options: RawRequestOptions,
    ): Promise<HttpResponse<T>> {
        return this.http.request<T>({
            method: options.method,
            path: options.path,
            query: options.query,
            body: options.body,
            headers: options.headers,
            idempotencyKey: options.idempotencyKey,
            signal: options.signal,
            timeoutMs: options.timeoutMs,
        })
    }

    /** Never serialize the client — it could tempt a key leak. */
    toJSON(): Record<string, unknown> {
        return { baseUrl: this.baseUrl }
    }

    [Symbol.for('nodejs.util.inspect.custom')](): string {
        return `Shorty { baseUrl: ${JSON.stringify(this.baseUrl)} }`
    }
}

export default Shorty
