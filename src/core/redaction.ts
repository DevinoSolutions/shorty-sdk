// Secret redaction for anything the SDK might emit (debug logs, error text
// snippets). The API key and webhook secrets must NEVER reach a log sink or a
// thrown error verbatim. Applied at every emit point, not just once.

const API_KEY_PATTERN = /shk_(live|test)_[A-Za-z0-9]+/g
const WEBHOOK_SECRET_PATTERN = /whsec_[A-Za-z0-9+/=_-]+/g
// Bearer <token> in any header dump — mask the token, keep the scheme.
const BEARER_PATTERN = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi

/**
 * Mask every known secret shape in a string. Idempotent and safe to call on any
 * user- or server-provided text before it is logged or attached to an error.
 */
export function redact(input: string): string {
    return input
        .replace(API_KEY_PATTERN, (_m, env: string) => `shk_${env}_***`)
        .replace(WEBHOOK_SECRET_PATTERN, 'whsec_***')
        .replace(BEARER_PATTERN, '$1***')
}
