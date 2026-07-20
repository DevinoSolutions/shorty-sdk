---
'@aishorty/sdk': minor
---

Initial release of `@aishorty/sdk` (0.1.0) — the official TypeScript client for
the Shorty public API (`aishorty.com/v1`).

-   Zero runtime dependencies (native `fetch`, `node:crypto`, `AbortSignal`).
-   Full coverage of the 11 released `/v1` operations: usage, articles
    (list/search/get), transcriptions (list/get/create), summaries (create),
    subtitles (create/download), and job status.
-   `jobs.waitFor()` convenience poller.
-   Typed RFC 9457 error hierarchy (code-driven, status-class fallback).
-   Automatic, idempotency-keyed retries with full-jitter backoff and
    `Retry-After` support; `quota_exhausted` is never retried.
-   Standard Webhooks signature verification (`verifyWebhookSignature`).
-   API keys are held in a closure and never appear in logs, thrown errors,
    `JSON.stringify`, or `util.inspect` output.
