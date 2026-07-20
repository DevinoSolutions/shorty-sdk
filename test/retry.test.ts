import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'

import { APIServerError, QuotaExhaustedError } from '../src/core/errors'
import {
    cappedRetryAfterMs,
    fullJitterBackoffMs,
} from '../src/core/retryPolicy'
import { Shorty } from '../src/index'
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
})

function client(overrides?: Partial<ConstructorParameters<typeof Shorty>[0]>) {
    return new Shorty({ apiKey: 'shk_test_retry', baseUrl, ...overrides })
}

test('Retry-After delta-seconds is honored (waits ~1s, then succeeds)', async () => {
    server.setHandler((_req, i) =>
        i === 0
            ? {
                  status: 429,
                  headers: { 'Retry-After': '1' },
                  body: {
                      code: 'rate_limited',
                      title: 'Rate limit exceeded',
                      status: 429,
                      type: 't',
                      instance: 'i',
                      request_id: 'r',
                  },
              }
            : { status: 200, body: okUsage() },
    )
    const start = Date.now()
    await client().usage.get()
    const elapsed = Date.now() - start
    assert.equal(server.requests.length, 2)
    assert.ok(elapsed >= 900, `expected >=900ms wait, got ${elapsed}`)
})

test('Retry-After HTTP-date is honored', async () => {
    server.setHandler((_req, i) =>
        i === 0
            ? {
                  status: 503,
                  headers: {
                      'Retry-After': new Date(Date.now() + 1000).toUTCString(),
                  },
                  body: {
                      code: 'service_unavailable',
                      title: 'Service unavailable',
                      status: 503,
                      type: 't',
                      instance: 'i',
                      request_id: 'r',
                  },
              }
            : { status: 200, body: okUsage() },
    )
    const start = Date.now()
    await client().usage.get()
    const elapsed = Date.now() - start
    assert.equal(server.requests.length, 2)
    assert.ok(elapsed >= 700, `expected ~1s wait, got ${elapsed}`)
})

test('429 rate_limited is retried', async () => {
    server.setHandler((_req, i) =>
        i === 0
            ? {
                  status: 429,
                  headers: { 'Retry-After': '0' },
                  body: {
                      code: 'rate_limited',
                      title: 'Rate limit exceeded',
                      status: 429,
                      type: 't',
                      instance: 'i',
                      request_id: 'r',
                  },
              }
            : { status: 200, body: okUsage() },
    )
    const usage = await client().usage.get()
    assert.equal(usage.plan.tier, 'free')
    assert.equal(server.requests.length, 2)
})

test('429 quota_exhausted is NEVER retried (throws QuotaExhaustedError)', async () => {
    server.setHandler(() => ({
        status: 429,
        headers: { 'Retry-After': '30' },
        body: {
            code: 'quota_exhausted',
            title: 'Quota exhausted',
            status: 429,
            type: 't',
            instance: 'i',
            request_id: 'r',
        },
    }))
    await assert.rejects(
        () => client().usage.get(),
        (err: unknown) => {
            assert.ok(err instanceof QuotaExhaustedError)
            assert.equal(err.retryAfterSeconds, 30)
            return true
        },
    )
    assert.equal(server.requests.length, 1)
})

test('503 is retried, then succeeds', async () => {
    server.setHandler((_req, i) =>
        i === 0
            ? {
                  status: 503,
                  body: {
                      code: 'service_unavailable',
                      title: 'Service unavailable',
                      status: 503,
                      type: 't',
                      instance: 'i',
                      request_id: 'r',
                  },
              }
            : { status: 200, body: okUsage() },
    )
    await client().usage.get()
    assert.equal(server.requests.length, 2)
})

test('POST without an Idempotency-Key is never retried', async () => {
    server.setHandler(() => ({
        status: 503,
        body: {
            code: 'service_unavailable',
            title: 'Service unavailable',
            status: 503,
            type: 't',
            instance: 'i',
            request_id: 'r',
        },
    }))
    await assert.rejects(
        () =>
            client().request({
                method: 'POST',
                path: '/v1/anything',
                body: { a: 1 },
            }),
        APIServerError,
    )
    assert.equal(server.requests.length, 1)
})

test('POST create auto-generates a key and reuses the SAME key across retries', async () => {
    server.setHandler((_req, i) =>
        i === 0
            ? {
                  status: 503,
                  body: {
                      code: 'service_unavailable',
                      title: 'Service unavailable',
                      status: 503,
                      type: 't',
                      instance: 'i',
                      request_id: 'r',
                  },
              }
            : {
                  status: 202,
                  body: {
                      job_id: 'j1',
                      status: 'queued',
                      tracking_url: '/v1/jobs/j1',
                  },
              },
    )
    const accepted = await client().summaries.create({
        source: 'text',
        content: 'hello world',
    })
    assert.equal(accepted.job_id, 'j1')
    assert.equal(server.requests.length, 2)
    const key0 = server.requests[0]?.headers['idempotency-key']
    const key1 = server.requests[1]?.headers['idempotency-key']
    assert.ok(key0 && key0.length > 0, 'first attempt carried a key')
    assert.equal(key0, key1, 'the same key is reused across attempts')
})

test('maxRetries exhausted throws the last error', async () => {
    server.setHandler(() => ({
        status: 503,
        body: {
            code: 'service_unavailable',
            title: 'Service unavailable',
            status: 503,
            type: 't',
            instance: 'i',
            request_id: 'r',
        },
    }))
    await assert.rejects(
        () => client({ maxRetries: 2 }).usage.get(),
        APIServerError,
    )
    // first try + 2 retries = 3 requests
    assert.equal(server.requests.length, 3)
})

test('backoff is capped at 8s and Retry-After at 60s (pure policy)', () => {
    // High attempt with rand()=~1 must not exceed the 8s cap.
    assert.equal(
        fullJitterBackoffMs(20, () => 0.999999),
        7999,
    )
    assert.equal(
        fullJitterBackoffMs(0, () => 0),
        0,
    )
    assert.equal(cappedRetryAfterMs(120_000), 60_000)
    assert.equal(cappedRetryAfterMs(2_000), 2_000)
})

function okUsage() {
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
