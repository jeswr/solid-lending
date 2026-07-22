/**
 * Next.js's `basePath` (`next.config.ts`) is applied automatically by
 * `next/link`/router navigation, but NOT by a plain client-side `fetch()` —
 * every browser-triggered API call in this app must prefix its own path
 * with this constant, or it silently 404s against the shell's rewrite
 * prefix (sm-qz3j.8 finding).
 */
export const BASE_PATH = "/wallet";
