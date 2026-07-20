# @aishorty/sdk

The official TypeScript SDK for the [Shorty](https://aishorty.com) public API
(`https://aishorty.com/v1`). Transcribe media, summarize videos and web pages,
generate subtitles, and poll async jobs — with typed errors, automatic retries,
cursor pagination, and Standard-Webhooks signature verification.

- **Zero runtime dependencies.** Native `fetch`, `node:crypto`, `AbortSignal`.
- **Node.js >= 20.** ESM and CommonJS builds, full type declarations.
- **Server-side only** — your API key is a secret. The client throws if it
  detects a browser environment.

## Install

```bash
npm install @aishorty/sdk
# or: pnpm add @aishorty/sdk  /  yarn add @aishorty/sdk
```

## Quickstart

```ts
import { Shorty } from '@aishorty/sdk'

const shorty = new Shorty({ apiKey: process.env.SHORTY_API_KEY })

// Start a summary job for a YouTube video…
const job = await shorty.summaries.create({
    source: 'youtube',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
})

// …then wait for it to finish.
const finished = await shorty.jobs.waitFor(job.job_id)
console.log(finished.status, finished.output)
```

## Authentication

Shorty accepts exactly one auth form: a **Bearer API key** (`shk_live_…`), sent
on every request as `Authorization: Bearer <key>`. Create keys in your developer
console.

```ts
// Explicit:
const shorty = new Shorty({ apiKey: 'shk_live_…' })

// Or omit it and the SDK reads process.env.SHORTY_API_KEY:
const shorty = new Shorty()
```

The key is held in a closure — it never appears in `JSON.stringify(client)`,
`util.inspect(client)`, thrown errors, or debug logs.

### Client options

| Option | Default | Description |
| --- | --- | --- |
| `apiKey` | `process.env.SHORTY_API_KEY` | Your `shk_live_…` key. Throws if unset. |
| `baseUrl` | `https://aishorty.com` | API origin (paths already include `/v1`). |
| `timeoutMs` | `60000` | Per-attempt timeout. |
| `maxRetries` | `2` | Retries after the first attempt. |
| `fetch` | `globalThis.fetch` | Override the fetch implementation. |
| `debug` | `false` | `true` logs to stderr; a function receives redacted log lines. |
| `dangerouslyAllowBrowser` | `false` | Allow construction where `window` exists (not recommended). |

## Resources

```ts
await shorty.usage.get()

const page = await shorty.articles.list({ limit: 20 })
await shorty.articles.search({ q: 'transformers', article_type: 'YOUTUBE_ARTICLE' })
await shorty.articles.get(articleId)

await shorty.transcriptions.list()
await shorty.transcriptions.get(id)
await shorty.transcriptions.create({ url: 'https://example.com/audio.mp3' })

await shorty.summaries.create({ source: 'url', url: 'https://example.com/post' })
await shorty.summaries.create({ source: 'text', content: 'Long text to summarize…' })

await shorty.subtitles.create({ url: 'https://example.com/clip.mp4', style: 'TIKTOK' })
await shorty.subtitles.download(jobId, { kind: 'srt' })

await shorty.jobs.get(jobId)
await shorty.jobs.waitFor(jobId)
```

Every method takes a trailing `opts?` with `{ signal, timeoutMs, headers }`
(and `idempotencyKey` on the create methods).

## Pagination

`list()` returns a `Page`. Iterate it with `for await` to walk **every** item
across all pages (the SDK follows the opaque cursor for you, reusing your
original filters), or page manually.

```ts
// Auto-iterate all items:
for await (const article of await shorty.articles.list({ limit: 50 })) {
    console.log(article.id, article.title)
}

// Manual page control:
let page = await shorty.articles.list({ limit: 50 })
while (page) {
    console.log(page.data.length, 'items; hasMore =', page.hasMore)
    page = (await page.nextPage()) ?? null
    if (!page) break
}
```

> Cursors are **filter-bound**: a cursor minted under one query cannot be
> replayed against a different filter. The SDK never mutates your params while
> paging, so this is handled automatically — just don't hand a cursor to a
> different `list()` call.

## Jobs & `waitFor`

Writes (`transcriptions.create`, `summaries.create`, `subtitles.create`) return
a `202` `{ job_id, status, tracking_url }`. Poll with `jobs.get(id)`, or use the
convenience poller:

```ts
try {
    const done = await shorty.jobs.waitFor(job.job_id, {
        pollIntervalMs: 2000, // default
        timeoutMs: 600_000, // default
        // signal: abortController.signal,
    })
    console.log('done:', done.output)
} catch (err) {
    if (err instanceof JobFailedError) {
        // The job ended in ERROR/CANCELLED — err.jobError has the reason.
    }
    if (err instanceof APITimeoutError) {
        // The deadline elapsed before the job finished.
    }
}
```

`waitFor` is a **client-side loop** — not a server feature. It resolves on
`SUCCESS`, throws `JobFailedError` on `ERROR`/`CANCELLED`, and `APITimeoutError`
on the deadline.

## Errors

Every non-2xx response throws a typed error. The class is chosen by the problem
`code` first, falling back to the HTTP status class for any unknown/absent code
(so a new server code never breaks your `instanceof` handling).

```ts
import {
    APIError,
    AuthenticationError,
    PermissionDeniedError,
    NotFoundError,
    ConflictError,
    ValidationError,
    RateLimitError,
    QuotaExhaustedError,
    APIServerError,
    APIConnectionError,
    APITimeoutError,
} from '@aishorty/sdk'

try {
    await shorty.usage.get()
} catch (err) {
    if (err instanceof QuotaExhaustedError) {
        // Period allowance spent — back off until the next window.
    } else if (err instanceof RateLimitError) {
        console.log('retry after', err.retryAfterSeconds, 's')
    } else if (err instanceof APIError) {
        console.log(err.status, err.code, err.title, err.detail, err.requestId)
        console.log(err.errors) // field-level validation errors, when present
    }
}
```

Every `APIError` carries `status`, `code`, `problemType`, `title`, `detail`,
`requestId`, `errors?`, `headers`, and (on 429s) `retryAfterSeconds`. The
`.message` is `title: detail (request_id)` and never contains your API key.

### Error code reference

| Code | Status | SDK error class |
| --- | --- | --- |
| `unauthorized` | 401 | `AuthenticationError` |
| `invalid_api_key` | 401 | `AuthenticationError` |
| `insufficient_scope` | 403 | `PermissionDeniedError` |
| `feature_not_enabled` | 403 | `PermissionDeniedError` |
| `resource_not_found` | 404 | `NotFoundError` |
| `idempotency_conflict` | 409 | `ConflictError` |
| `idempotency_in_progress` | 409 | `ConflictError` |
| `resource_not_ready` | 409 | `ConflictError` |
| `validation_failed` | 400 | `ValidationError` |
| `idempotency_key_reused` | 422 | `ValidationError` |
| `request_too_large` | 413 | `ValidationError` |
| `rate_limited` | 429 | `RateLimitError` |
| `quota_exhausted` | 429 | `QuotaExhaustedError` |
| `internal_error` | 500 | `APIServerError` |
| `service_unavailable` | 503 | `APIServerError` |

Transport-level failures throw `APIConnectionError` (with `cause`) or
`APITimeoutError`.

## Retries & idempotency

The SDK automatically retries transient failures up to `maxRetries` times
(default 2) after the first attempt.

**Retried:** connection errors · per-attempt timeouts · `408` · `429`
`rate_limited` (or a `429` with no parseable code) · `500` / `502` / `503` /
`504`.

**Never retried:** `429` `quota_exhausted` (a spent period allowance — retrying
won't help) · any other `4xx` · requests you aborted via your own `signal`.

**Backoff:** a `Retry-After` header is honored when present (both delta-seconds
and HTTP-date forms, capped at 60s); otherwise full-jitter exponential backoff,
`random(0, min(0.5 · 2^attempt, 8))` seconds.

**POST safety:** an unsafe `POST` is retried **only** when it carries an
`Idempotency-Key`. The three create methods auto-generate one (a UUID) and reuse
the **same** key across every retry attempt, so retries are deduplicated
server-side. Supply your own via `opts.idempotencyKey` to make a call idempotent
across process restarts:

```ts
await shorty.summaries.create(
    { source: 'text', content: '…' },
    { idempotencyKey: 'my-stable-key-123' },
)
```

`client.request(...)` POSTs are **not** retried unless you pass an
`idempotencyKey` yourself.

## Webhooks

Verify inbound Shorty webhooks with `verifyWebhookSignature`. It implements the
[Standard Webhooks](https://www.standardwebhooks.com) v1 scheme (HMAC-SHA256,
`webhook-id` / `webhook-timestamp` / `webhook-signature` headers, rotation via
multiple space-separated signatures, a 5-minute replay tolerance, constant-time
comparison).

```ts
import { verifyWebhookSignature } from '@aishorty/sdk'

// Express example — note express.raw(), NOT express.json():
app.post('/webhooks/shorty', express.raw({ type: '*/*' }), (req, res) => {
    const result = verifyWebhookSignature({
        payload: req.body, // the RAW body (Buffer/Uint8Array or string)
        headers: req.headers, // Headers object or lowercase-keyed record
        secret: process.env.SHORTY_WEBHOOK_SECRET!, // whsec_…
    })
    if (!result.valid) {
        return res.status(400).json({ error: result.reason })
    }
    // Safe to handle. Parse the body only AFTER verifying.
    const event = JSON.parse(Buffer.from(req.body).toString('utf8'))
    res.sendStatus(200)
})
```

> **Raw body only.** You must verify the **exact bytes** you received. Do not
> `JSON.parse` and re-`JSON.stringify` the body before verifying —
> re-serialization reorders keys and changes whitespace, which **will** fail
> verification. In frameworks that auto-parse JSON, capture the raw body first
> (e.g. `express.raw()`, or `await request.text()` in a Next.js route).

`verifyWebhookSignature` returns a discriminated result:

```ts
type WebhookVerifyResult =
    | { valid: true }
    | {
          valid: false
          reason:
              | 'missing_headers'
              | 'malformed_timestamp'
              | 'timestamp_out_of_tolerance'
              | 'no_matching_signature'
      }
```

## License

MIT © Devino Solutions
