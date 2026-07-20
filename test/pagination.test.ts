import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'

import { Shorty } from '../src/index'
import { MockShortyServer, type MockRequest } from './mockShortyServer'

const server = new MockShortyServer()
let baseUrl: string

before(async () => {
    baseUrl = await server.start()
})
after(async () => {
    await server.close()
})
beforeEach(() => {
    server.requests.length = 0
})

function client() {
    return new Shorty({ apiKey: 'shk_test_page', baseUrl })
}

function article(id: string) {
    return {
        id,
        title: `t${id}`,
        description: null,
        article_type: 'TEXT_ARTICLE',
        source_url: null,
        created_at: '2026-07-20T12:00:00.000Z',
    }
}

// Three pages: cursor null -> "c1" -> "c2" -> end.
function threePageHandler(req: MockRequest) {
    const cursor = req.query['cursor']
    if (!cursor) {
        return {
            status: 200,
            body: {
                data: [article('1'), article('2')],
                has_more: true,
                next_cursor: 'c1',
            },
        }
    }
    if (cursor === 'c1') {
        return {
            status: 200,
            body: {
                data: [article('3'), article('4')],
                has_more: true,
                next_cursor: 'c2',
            },
        }
    }
    return {
        status: 200,
        body: { data: [article('5')], has_more: false, next_cursor: null },
    }
}

test('async iterator walks all 3 pages, reusing original params + cursor chain', async () => {
    server.setHandler(threePageHandler)
    const ids: string[] = []
    const page = await client().articles.list({ limit: 2 })
    for await (const a of page) ids.push(a.id)
    assert.deepEqual(ids, ['1', '2', '3', '4', '5'])
    assert.equal(server.requests.length, 3)
    // Every request keeps the original limit param; only cursor advances.
    assert.equal(server.requests[0]?.query['limit'], '2')
    assert.equal(server.requests[0]?.query['cursor'], undefined)
    assert.equal(server.requests[1]?.query['limit'], '2')
    assert.equal(server.requests[1]?.query['cursor'], 'c1')
    assert.equal(server.requests[2]?.query['cursor'], 'c2')
})

test('manual nextPage() advances one page and returns null at the end', async () => {
    server.setHandler(threePageHandler)
    const c = client()
    const p1 = await c.articles.list({ limit: 2 })
    assert.deepEqual(
        p1.data.map(a => a.id),
        ['1', '2'],
    )
    assert.equal(p1.hasMore, true)
    assert.equal(p1.nextCursor, 'c1')

    const p2 = await p1.nextPage()
    assert.ok(p2)
    assert.deepEqual(
        p2.data.map(a => a.id),
        ['3', '4'],
    )
    const p3 = await p2.nextPage()
    assert.ok(p3)
    assert.equal(p3.hasMore, false)
    const end = await p3.nextPage()
    assert.equal(end, null)
})

test('empty first page terminates the iterator immediately', async () => {
    server.setHandler(() => ({
        status: 200,
        body: { data: [], has_more: false, next_cursor: null },
    }))
    const seen: string[] = []
    const page = await client().articles.list()
    for await (const a of page) seen.push(a.id)
    assert.deepEqual(seen, [])
    assert.equal(server.requests.length, 1)
})
