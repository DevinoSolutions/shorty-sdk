// Idempotency-Key generation for the three create ops. A UUID v4 from the
// platform crypto — reused across every retry attempt of ONE logical call so a
// retried POST is deduplicated server-side by the /v1 idempotency ledger.

import { randomUUID } from 'node:crypto'

export function newIdempotencyKey(): string {
    return randomUUID()
}
