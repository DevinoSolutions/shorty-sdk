import type { HttpClient, QueryParams } from '../core/http'
import { Page } from '../core/pagination'
import type {
    Article,
    ArticleDetail,
    ArticleListResponse,
    ArticleSearchResponse,
    ArticleType,
} from '../types'
import type { RequestOptions } from './common'

export interface ListArticlesParams {
    /** Max rows per page (server-clamped). */
    limit?: number
    /** Opaque cursor from a previous page's `nextCursor`. */
    cursor?: string
}

export interface SearchArticlesParams {
    /** The full-text query. */
    q: string
    /** Max hits to return. */
    limit?: number
    /** Restrict to a single article type. */
    article_type?: ArticleType
}

/** `client.articles` — list, search, and fetch summarized articles. */
export class ArticlesResource {
    constructor(private readonly http: HttpClient) {}

    /** GET /v1/articles — cursor-paginated. Iterate the returned `Page`. */
    async list(
        params?: ListArticlesParams,
        opts?: RequestOptions,
    ): Promise<Page<Article>> {
        const baseQuery: QueryParams = { limit: params?.limit }
        const fetchPage = async (
            cursor: string | undefined,
        ): Promise<Page<Article>> => {
            const { data } = await this.http.request<ArticleListResponse>({
                method: 'GET',
                path: '/v1/articles',
                query: { ...baseQuery, cursor },
                signal: opts?.signal,
                timeoutMs: opts?.timeoutMs,
                headers: opts?.headers,
            })
            return new Page<Article>(data, fetchPage)
        }
        return fetchPage(params?.cursor)
    }

    /** GET /v1/articles/search — relevance-ranked, not paginated. */
    async search(
        params: SearchArticlesParams,
        opts?: RequestOptions,
    ): Promise<ArticleSearchResponse> {
        const { data } = await this.http.request<ArticleSearchResponse>({
            method: 'GET',
            path: '/v1/articles/search',
            query: {
                q: params.q,
                limit: params.limit,
                article_type: params.article_type,
            },
            signal: opts?.signal,
            timeoutMs: opts?.timeoutMs,
            headers: opts?.headers,
        })
        return data
    }

    /** GET /v1/articles/{id} */
    async get(id: string, opts?: RequestOptions): Promise<ArticleDetail> {
        const { data } = await this.http.request<ArticleDetail>({
            method: 'GET',
            path: `/v1/articles/${encodeURIComponent(id)}`,
            signal: opts?.signal,
            timeoutMs: opts?.timeoutMs,
            headers: opts?.headers,
        })
        return data
    }
}
