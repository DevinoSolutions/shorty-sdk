// Single source of truth for the SDK version, used in the User-Agent header.
// Kept in sync with package.json by `test/client.test.ts` (the build must fail
// if these drift).
export const VERSION = '0.1.0'
