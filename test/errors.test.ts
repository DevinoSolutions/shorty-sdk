import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'

import {
    APIError,
    APIServerError,
    AuthenticationError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    QuotaExhaustedError,
    RateLimitError,
    ValidationError,
} from '../src/core/errors'
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

function client() {
    return new Shorty({ apiKey: 'shk_test_err', baseUrl, maxRetries: 0 })
}

function problem(
    code: string,
    status: number,
    extra: Record<string, unknown> = {},
) {
    return {
        status,
        headers: { 'Content-Type': 'application/problem+json' },
        body: {
            type: `https://aishorty.com/docs/api/errors/${code}`,
            title: code,
            status,
            code,
            instance: 'urn:request:req_1',
            request_id: 'req_1',
            ...extra,
        },
    }
}

const cases: Array<[string, number, new (...a: never[]) => APIError]> = [
    ['unauthorized', 401, AuthenticationError],
    ['invalid_api_key', 401, AuthenticationError],
    ['insufficient_scope', 403, PermissionDeniedError],
    ['feature_not_enabled', 403, PermissionDeniedError],
    ['resource_not_found', 404, NotFoundError],
    ['idempotency_conflict', 409, ConflictError],
    ['idempotency_in_progress', 409, ConflictError],
    ['resource_not_ready', 409, ConflictError],
    ['validation_failed', 400, ValidationError],
    ['idempotency_key_reused', 422, ValidationError],
    ['request_too_large', 413, ValidationError],
    ['rate_limited', 429, RateLimitError],
    ['quota_exhausted', 429, QuotaExhaustedError],
    ['internal_error', 500, APIServerError],
    ['service_unavailable', 503, APIServerError],
]

for (const [code, status, Ctor] of cases) {
    test(`code ${code} -> ${Ctor.name}`, async () => {
        server.setHandler(() => problem(code, status))
        await assert.rejects(
            () => client().usage.get(),
            (err: unknown) => {
                assert.ok(err instanceof Ctor, `expected ${Ctor.name}`)
                assert.ok(err instanceof APIError)
                assert.equal(err.code, code)
                assert.equal(err.status, status)
                assert.equal(err.requestId, 'req_1')
                return true
            },
        )
    })
}

test('unknown code falls back to status class (403 -> PermissionDeniedError)', async () => {
    server.setHandler(() => problem('some_future_code', 403))
    await assert.rejects(
        () => client().usage.get(),
        (err: unknown) => {
            assert.ok(err instanceof PermissionDeniedError)
            assert.equal((err as APIError).code, 'some_future_code')
            return true
        },
    )
})

test('non-JSON 502 body maps by status with a redacted text snippet', async () => {
    server.setHandler(() => ({
        status: 502,
        headers: { 'Content-Type': 'text/html' },
        body: '<html><body>Bad Gateway shk_live_supersecretvalue</body></html>',
    }))
    await assert.rejects(
        () => client().usage.get(),
        (err: unknown) => {
            assert.ok(err instanceof APIServerError)
            const e = err as APIError
            assert.equal(e.status, 502)
            assert.equal(e.code, undefined)
            assert.ok(e.detail?.includes('Bad Gateway'))
            assert.ok(!e.message.includes('supersecretvalue'))
            assert.ok(!e.detail?.includes('supersecretvalue'))
            return true
        },
    )
})

test('field errors are surfaced on validation problems', async () => {
    server.setHandler(() =>
        problem('validation_failed', 400, {
            detail: 'Invalid body',
            errors: [
                { pointer: '#/body/url', code: 'invalid_type', message: 'bad' },
            ],
        }),
    )
    await assert.rejects(
        () => client().usage.get(),
        (err: unknown) => {
            const e = err as ValidationError
            assert.equal(e.errors?.length, 1)
            assert.equal(e.errors?.[0]?.pointer, '#/body/url')
            assert.ok(e.message.includes('Invalid body'))
            return true
        },
    )
})

test('requestId falls back to the Request-Id header when body omits it', async () => {
    server.setHandler(() => ({
        status: 500,
        headers: { 'Request-Id': 'hdr_req_9' },
        body: 'internal boom',
    }))
    await assert.rejects(
        () => client().usage.get(),
        (err: unknown) => {
            assert.equal((err as APIError).requestId, 'hdr_req_9')
            return true
        },
    )
})
