// Standard Webhooks v1 signature verification for RECEIVERS of Shorty webhooks.
//
// Re-implemented from the server's `src/lib/webhooks/signing.ts` (NOT imported —
// this ships to third parties). The semantics mirror it byte-for-byte:
//   signed content = `${webhook-id}.${webhook-timestamp}.${rawBody}`  (UTF-8)
//   key            = base64-DECODED bytes of the secret AFTER the `whsec_` tag
//   signature      = `v1,` + base64(HMAC-SHA256(key, signedContent))
//   header may carry several space-separated `v1,` tokens (rotation) — ANY match
//   passes; non-`v1,` tokens are ignored, not rejected.
//
// RAW-BODY RULE (load-bearing): verify the EXACT bytes received. A
// `JSON.parse(body)` then re-`JSON.stringify` reorders keys / changes spacing
// and WILL fail verification. Pass the raw request body string or bytes.

import { createHmac, timingSafeEqual } from 'node:crypto'

const SECRET_PREFIX = 'whsec_'
const SIGNATURE_VERSION = 'v1'
const DEFAULT_TOLERANCE_SECONDS = 300

/** Why verification failed. The first three mirror the server module exactly;
 * `missing_headers` is SDK-only (the SDK extracts headers the server takes as
 * separate args). */
export type WebhookVerifyFailure =
    | 'missing_headers'
    | 'malformed_timestamp'
    | 'timestamp_out_of_tolerance'
    | 'no_matching_signature'

export type WebhookVerifyResult =
    | { valid: true }
    | { valid: false; reason: WebhookVerifyFailure }

/** Headers as a `Headers` object OR a plain (case-insensitive) record. */
export type WebhookHeaders =
    | Headers
    | Record<string, string | string[] | undefined>

export interface VerifyWebhookInput {
    /** The RAW request body — exactly as received (string or bytes). */
    payload: string | Uint8Array
    /** The request headers (webhook-id / webhook-timestamp / webhook-signature). */
    headers: WebhookHeaders
    /** The endpoint's signing secret (`whsec_...`). */
    secret: string
    /** Replay tolerance in seconds (default 300 = 5 minutes). */
    toleranceSeconds?: number
    /** "Now" in epoch SECONDS — injectable for testing. */
    nowSeconds?: number
}

/**
 * Verify a received Shorty webhook. Returns a discriminated result rather than
 * throwing, so a receiver can branch on `result.valid` and inspect `reason`.
 */
export function verifyWebhookSignature(
    input: VerifyWebhookInput,
): WebhookVerifyResult {
    const id = headerValue(input.headers, 'webhook-id')
    const timestampHeader = headerValue(input.headers, 'webhook-timestamp')
    const signatureHeader = headerValue(input.headers, 'webhook-signature')

    if (
        id === undefined ||
        timestampHeader === undefined ||
        signatureHeader === undefined
    ) {
        return { valid: false, reason: 'missing_headers' }
    }

    const timestamp = Number(timestampHeader)
    if (
        timestampHeader.trim() === '' ||
        !Number.isFinite(timestamp) ||
        !Number.isInteger(timestamp)
    ) {
        return { valid: false, reason: 'malformed_timestamp' }
    }

    const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000)
    const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
    if (Math.abs(nowSeconds - timestamp) > tolerance) {
        return { valid: false, reason: 'timestamp_out_of_tolerance' }
    }

    const rawBody =
        typeof input.payload === 'string'
            ? input.payload
            : new TextDecoder().decode(input.payload)
    const content = `${id}.${timestamp}.${rawBody}`
    const expected = new Uint8Array(
        Buffer.from(hmacBase64(input.secret, content), 'base64'),
    )

    for (const token of signatureHeader.split(' ')) {
        const comma = token.indexOf(',')
        if (comma < 0) continue
        if (token.slice(0, comma) !== SIGNATURE_VERSION) continue
        const candidate = new Uint8Array(
            Buffer.from(token.slice(comma + 1), 'base64'),
        )
        // timingSafeEqual requires equal length — an unequal candidate can
        // never match, so skip it rather than let it throw.
        if (candidate.length !== expected.length) continue
        if (candidate.length === 0) continue
        if (timingSafeEqual(candidate, expected)) return { valid: true }
    }
    return { valid: false, reason: 'no_matching_signature' }
}

function hmacBase64(secret: string, content: string): string {
    const b64 = secret.startsWith(SECRET_PREFIX)
        ? secret.slice(SECRET_PREFIX.length)
        : secret
    const key = new Uint8Array(Buffer.from(b64, 'base64'))
    return createHmac('sha256', key).update(content, 'utf8').digest('base64')
}

function headerValue(
    headers: WebhookHeaders,
    name: string,
): string | undefined {
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        const value = headers.get(name)
        return value === null ? undefined : value
    }
    const record = headers as Record<string, string | string[] | undefined>
    // Case-insensitive lookup (the wire names are lowercase, but be lenient).
    const direct = record[name]
    const found =
        direct !== undefined ? direct : lookupCaseInsensitive(record, name)
    if (found === undefined) return undefined
    return Array.isArray(found) ? found[0] : found
}

function lookupCaseInsensitive(
    record: Record<string, string | string[] | undefined>,
    name: string,
): string | string[] | undefined {
    const lower = name.toLowerCase()
    for (const key of Object.keys(record)) {
        if (key.toLowerCase() === lower) return record[key]
    }
    return undefined
}
