// Shared option shapes for every resource method's trailing `opts?` argument.

export interface RequestOptions {
    /** Abort the request (and any pending retries) via an AbortSignal. */
    signal?: AbortSignal
    /** Override the client's per-attempt timeout for this call, in ms. */
    timeoutMs?: number
    /** Extra headers merged onto this request. */
    headers?: Record<string, string>
}

/** Trailing options for write (POST) methods: adds an explicit idempotency key. */
export interface WriteOptions extends RequestOptions {
    /**
     * Supply your own Idempotency-Key. If omitted, the SDK auto-generates one
     * (a UUID) so the write is retry-safe by default. The SAME key is reused
     * across every retry attempt of this call.
     */
    idempotencyKey?: string
}
