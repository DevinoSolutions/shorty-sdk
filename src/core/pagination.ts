// Cursor pagination. A `Page<T>` is one server page PLUS a bound fetcher for the
// next one, so iterating reuses the ORIGINAL query params and only advances the
// opaque `cursor` (server-side the cursor is filter-bound — reuse against a
// different filter is rejected, so we never mutate the other params).

/** The stable wire envelope every /v1 collection returns. */
export interface ListEnvelope<T> {
    data: T[]
    has_more: boolean
    next_cursor: string | null
}

/** Fetch one page given a cursor (undefined = first page). */
export type PageFetcher<T> = (cursor: string | undefined) => Promise<Page<T>>

/**
 * One page of a cursor-paginated collection. Async-iterable: `for await (const
 * item of page)` walks EVERY item across all following pages; `.nextPage()`
 * fetches the next page manually (or `null` at the end).
 */
export class Page<T> implements AsyncIterable<T> {
    /** The rows on this page. */
    readonly data: T[]
    /** Whether another page exists after this one. */
    readonly hasMore: boolean
    /** Opaque cursor for the next page, or null on the last page. */
    readonly nextCursor: string | null

    private readonly fetchNext: PageFetcher<T>

    constructor(envelope: ListEnvelope<T>, fetchNext: PageFetcher<T>) {
        this.data = envelope.data
        this.hasMore = envelope.has_more
        this.nextCursor = envelope.next_cursor
        this.fetchNext = fetchNext
    }

    /** Fetch the next page, or `null` if this is the last one. */
    async nextPage(): Promise<Page<T> | null> {
        if (!this.hasMore || this.nextCursor === null) return null
        return this.fetchNext(this.nextCursor)
    }

    async *[Symbol.asyncIterator](): AsyncIterator<T> {
        for (const item of this.data) yield item
        let page = await this.nextPage()
        while (page !== null) {
            for (const item of page.data) yield item
            page = await page.nextPage()
        }
    }
}
