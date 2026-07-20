import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import { inspect } from 'node:util'

import { Shorty } from '../src/index'
import { VERSION } from '../src/version'
import { MockShortyServer } from './mockShortyServer'

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
    delete process.env.SHORTY_API_KEY
})

const SECRET = 'shk_live_abcdef123456SECRET'

function usageBody() {
    return {
        plan: { tier: 'free', planName: 'Free' },
        subscription: {
            isSubscribed: false,
            isProSubscriber: false,
            isOnTrial: false,
            trialEndsAt: null,
            expiresAt: null,
            willRenew: null,
        },
        limits: {
            transcription: {
                maxUploadSizeGb: 2,
                maxUploadSizeLabel: '2 GB',
                realtimeMaxDurationMinutes: 30,
                realtimeMaxDurationLabel: '30 min',
            },
            conversion: {
                maxFileSizeMb: 100,
                maxFileSizeLabel: '100 MB',
                maxBatchItems: 5,
                canUseManagedQueue: true,
                dailyCloudQuota: 10,
            },
        },
        usage: {
            cloudConversionsUsedLast24h: 0,
            cloudConversionsRemaining: 10,
        },
    }
}

test('sends Authorization, User-Agent, X-Shorty-SDK, and Accept headers', async () => {
    server.setHandler(() => ({ status: 200, body: usageBody() }))
    await new Shorty({ apiKey: SECRET, baseUrl }).usage.get()
    const h = server.requests[0]?.headers ?? {}
    assert.equal(h['authorization'], `Bearer ${SECRET}`)
    assert.equal(h['accept'], 'application/json')
    assert.ok(h['user-agent']?.startsWith(`aishorty-sdk/${VERSION} node/`))
    assert.equal(h['x-shorty-sdk'], h['user-agent'])
})

test('constructor throws a clear error when no key is given', () => {
    assert.throws(
        () => new Shorty({ baseUrl }),
        /Missing Shorty API key.*SHORTY_API_KEY/s,
    )
})

test('falls back to SHORTY_API_KEY env var', async () => {
    process.env.SHORTY_API_KEY = SECRET
    server.setHandler(() => ({ status: 200, body: usageBody() }))
    await new Shorty({ baseUrl }).usage.get()
    assert.equal(
        server.requests[0]?.headers['authorization'],
        `Bearer ${SECRET}`,
    )
})

test('browser guard throws when window is defined; escape hatch allows it', () => {
    const g = globalThis as { window?: unknown }
    g.window = {}
    try {
        assert.throws(
            () => new Shorty({ apiKey: SECRET, baseUrl }),
            /browser-like environment/,
        )
        // Escape hatch: no throw.
        const c = new Shorty({
            apiKey: SECRET,
            baseUrl,
            dangerouslyAllowBrowser: true,
        })
        assert.ok(c instanceof Shorty)
    } finally {
        delete g.window
    }
})

test('the API key never leaks via JSON.stringify or util.inspect', () => {
    const c = new Shorty({ apiKey: SECRET, baseUrl })
    const json = JSON.stringify(c)
    const inspected = inspect(c, { depth: 10 })
    const deep = inspect({ client: c, nested: [c] }, { depth: 10 })
    for (const s of [json, inspected, deep]) {
        assert.ok(!s.includes(SECRET), `leak in: ${s}`)
        assert.ok(!s.includes('abcdef123456'), `partial leak in: ${s}`)
    }
    // toJSON exposes only baseUrl.
    assert.deepEqual(JSON.parse(json), { baseUrl })
})

test('debug logger redacts secrets in emitted strings', () => {
    const lines: string[] = []
    const c = new Shorty({
        apiKey: SECRET,
        baseUrl,
        debug: msg => lines.push(msg),
    })
    // Drive a request so the logger emits at least one line.
    server.setHandler(() => ({ status: 200, body: usageBody() }))
    return c.usage.get().then(() => {
        assert.ok(lines.length > 0)
        for (const l of lines) assert.ok(!l.includes(SECRET))
    })
})

test('debug redactor masks a key/secret fed directly through it', () => {
    const lines: string[] = []
    const c = new Shorty({
        apiKey: SECRET,
        baseUrl,
        // The wrapper redacts every string before the user function sees it.
        debug: msg => lines.push(msg),
    })
    // Reach the redacting wrapper by logging a crafted message via a request
    // whose path carries a secret-shaped token.
    server.setHandler(() => ({ status: 200, body: usageBody() }))
    return c
        .request({ method: 'GET', path: '/v1/x-shk_live_leakytoken12345' })
        .then(() => {
            const joined = lines.join('\n')
            assert.ok(!joined.includes('shk_live_leakytoken12345'))
            assert.ok(joined.includes('shk_live_***'))
        })
})

test('per-attempt timeout aborts a slow response (real mock-server delay)', async () => {
    server.setHandler(() => ({ status: 200, body: usageBody(), delayMs: 300 }))
    const c = new Shorty({
        apiKey: SECRET,
        baseUrl,
        timeoutMs: 50,
        maxRetries: 0,
    })
    await assert.rejects(() => c.usage.get(), /timed out/i)
})

test("caller's AbortSignal propagates as an abort (not a timeout)", async () => {
    server.setHandler(() => ({ status: 200, body: usageBody(), delayMs: 500 }))
    const c = new Shorty({ apiKey: SECRET, baseUrl, maxRetries: 3 })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 50)
    await assert.rejects(
        () => c.usage.get({ signal: ac.signal }),
        (err: unknown) => {
            assert.equal((err as { name?: string }).name, 'AbortError')
            return true
        },
    )
    // Aborted before completion: only one attempt was made, no retries.
    assert.equal(server.requests.length, 1)
})

test('version.ts matches package.json version', () => {
    const pkg = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    assert.equal(VERSION, pkg.version)
})
