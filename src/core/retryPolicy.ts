// Pure retry-delay math, factored out of http.ts so the caps are unit-testable
// without waiting on a real timer.

/** Full-jitter exponential backoff cap, in seconds. */
export const BACKOFF_CAP_SECONDS = 8
/** A `Retry-After` is honored but never blocks longer than this, in ms. */
export const RETRY_AFTER_CAP_MS = 60_000

/**
 * Full-jitter backoff for a 0-based attempt index: a uniform random draw in
 * `[0, min(0.5 * 2^attempt, 8)) ` seconds, returned as whole milliseconds.
 * `rand` is injectable for deterministic tests.
 */
export function fullJitterBackoffMs(
    attempt: number,
    rand: () => number = Math.random,
): number {
    const capSeconds = Math.min(0.5 * 2 ** attempt, BACKOFF_CAP_SECONDS)
    return Math.floor(rand() * capSeconds * 1000)
}

/** Clamp a Retry-After delay (ms) to the 60s ceiling. */
export function cappedRetryAfterMs(ms: number): number {
    return Math.min(ms, RETRY_AFTER_CAP_MS)
}
