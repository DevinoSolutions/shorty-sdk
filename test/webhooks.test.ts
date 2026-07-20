import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { test } from 'node:test'

import { verifyWebhookSignature } from '../src/index'

// Local sign helper — mirrors the SERVER's signing.ts so tests produce genuine
// signatures the SDK verifier must accept. (The SDK ships only the verifier.)
function makeSecret(): string {
    return `whsec_${randomBytes(24).toString('base64')}`
}
function sign(secret: string, content: string): string {
    const b64 = secret.startsWith('whsec_') ? secret.slice(6) : secret
    const key = new Uint8Array(Buffer.from(b64, 'base64'))
    return createHmac('sha256', key).update(content, 'utf8').digest('base64')
}
function headersFor(id: string, ts: number, sigHeader: string) {
    return {
        'webhook-id': id,
        'webhook-timestamp': String(ts),
        'webhook-signature': sigHeader,
    }
}

const NOW = 1_753_000_000
const ID = 'msg_123'

test('valid single signature verifies', () => {
    const secret = makeSecret()
    const body = '{"event":"job.succeeded","data":{"id":"j1"}}'
    const sig = `v1,${sign(secret, `${ID}.${NOW}.${body}`)}`
    const result = verifyWebhookSignature({
        payload: body,
        headers: headersFor(ID, NOW, sig),
        secret,
        nowSeconds: NOW,
    })
    assert.deepEqual(result, { valid: true })
})

test('rotation: header with two signatures verifies against the old secret', () => {
    const oldSecret = makeSecret()
    const newSecret = makeSecret()
    const body = '{"a":1}'
    const content = `${ID}.${NOW}.${body}`
    const sigHeader = `v1,${sign(newSecret, content)} v1,${sign(oldSecret, content)}`
    // A receiver still on the OLD secret must accept.
    const result = verifyWebhookSignature({
        payload: body,
        headers: headersFor(ID, NOW, sigHeader),
        secret: oldSecret,
        nowSeconds: NOW,
    })
    assert.deepEqual(result, { valid: true })
})

test('unknown version tokens (v2,) are ignored, not rejected', () => {
    const secret = makeSecret()
    const body = '{"a":1}'
    const sig = `v2,deadbeef v1,${sign(secret, `${ID}.${NOW}.${body}`)}`
    const result = verifyWebhookSignature({
        payload: body,
        headers: headersFor(ID, NOW, sig),
        secret,
        nowSeconds: NOW,
    })
    assert.deepEqual(result, { valid: true })
})

test('tampered body fails', () => {
    const secret = makeSecret()
    const body = '{"amount":100}'
    const sig = `v1,${sign(secret, `${ID}.${NOW}.${body}`)}`
    const result = verifyWebhookSignature({
        payload: '{"amount":999}',
        headers: headersFor(ID, NOW, sig),
        secret,
        nowSeconds: NOW,
    })
    assert.deepEqual(result, { valid: false, reason: 'no_matching_signature' })
})

test('reserialized JSON body fails (the raw-byte rule)', () => {
    const secret = makeSecret()
    // Sender signed THIS exact byte string (note the whitespace).
    const raw = '{ "a": 1, "b": 2 }'
    const sig = `v1,${sign(secret, `${ID}.${NOW}.${raw}`)}`
    // A receiver that parses then re-stringifies changes the bytes (drops spaces).
    const reserialized = JSON.stringify(JSON.parse(raw)) // -> '{"a":1,"b":2}'
    const result = verifyWebhookSignature({
        payload: reserialized,
        headers: headersFor(ID, NOW, sig),
        secret,
        nowSeconds: NOW,
    })
    // The reserialized form differs from the raw bytes, so verification fails.
    assert.notEqual(reserialized === raw, true)
    assert.deepEqual(result, { valid: false, reason: 'no_matching_signature' })
})

test('stale timestamp (older than tolerance) fails', () => {
    const secret = makeSecret()
    const body = '{"a":1}'
    const oldTs = NOW - 3600
    const sig = `v1,${sign(secret, `${ID}.${oldTs}.${body}`)}`
    const result = verifyWebhookSignature({
        payload: body,
        headers: headersFor(ID, oldTs, sig),
        secret,
        nowSeconds: NOW,
        toleranceSeconds: 300,
    })
    assert.deepEqual(result, {
        valid: false,
        reason: 'timestamp_out_of_tolerance',
    })
})

test('future skew within tolerance passes', () => {
    const secret = makeSecret()
    const body = '{"a":1}'
    const futureTs = NOW + 120 // within 300s tolerance
    const sig = `v1,${sign(secret, `${ID}.${futureTs}.${body}`)}`
    const result = verifyWebhookSignature({
        payload: body,
        headers: headersFor(ID, futureTs, sig),
        secret,
        nowSeconds: NOW,
    })
    assert.deepEqual(result, { valid: true })
})

test('malformed timestamp header fails', () => {
    const secret = makeSecret()
    const body = '{"a":1}'
    const sig = `v1,${sign(secret, `${ID}.${NOW}.${body}`)}`
    const result = verifyWebhookSignature({
        payload: body,
        headers: headersFor(ID, NOW, sig),
        secret,
        nowSeconds: NOW,
    })
    // sanity: valid first
    assert.deepEqual(result, { valid: true })
    const bad = verifyWebhookSignature({
        payload: body,
        headers: {
            'webhook-id': ID,
            'webhook-timestamp': 'not-a-number',
            'webhook-signature': sig,
        },
        secret,
        nowSeconds: NOW,
    })
    assert.deepEqual(bad, { valid: false, reason: 'malformed_timestamp' })
})

test('bad secret format (wrong secret) fails to match', () => {
    const signer = makeSecret()
    const wrong = makeSecret()
    const body = '{"a":1}'
    const sig = `v1,${sign(signer, `${ID}.${NOW}.${body}`)}`
    const result = verifyWebhookSignature({
        payload: body,
        headers: headersFor(ID, NOW, sig),
        secret: wrong,
        nowSeconds: NOW,
    })
    assert.deepEqual(result, { valid: false, reason: 'no_matching_signature' })
})

test('missing headers -> missing_headers', () => {
    const result = verifyWebhookSignature({
        payload: '{}',
        headers: {},
        secret: makeSecret(),
        nowSeconds: NOW,
    })
    assert.deepEqual(result, { valid: false, reason: 'missing_headers' })
})

test('accepts a Headers object as well as a record', () => {
    const secret = makeSecret()
    const body = '{"a":1}'
    const sig = `v1,${sign(secret, `${ID}.${NOW}.${body}`)}`
    const h = new Headers()
    h.set('webhook-id', ID)
    h.set('webhook-timestamp', String(NOW))
    h.set('webhook-signature', sig)
    const result = verifyWebhookSignature({
        payload: body,
        headers: h,
        secret,
        nowSeconds: NOW,
    })
    assert.deepEqual(result, { valid: true })
})

test('verifies a Uint8Array raw body', () => {
    const secret = makeSecret()
    const body = '{"a":1}'
    const sig = `v1,${sign(secret, `${ID}.${NOW}.${body}`)}`
    const result = verifyWebhookSignature({
        payload: new TextEncoder().encode(body),
        headers: headersFor(ID, NOW, sig),
        secret,
        nowSeconds: NOW,
    })
    assert.deepEqual(result, { valid: true })
})
