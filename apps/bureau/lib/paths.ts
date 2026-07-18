/**
 * The zone app's basePath (matches the registry `path` for "bureau" in
 * apps/tour/content/walkthrough.json and next.config.ts's `basePath`). Client
 * code must prefix same-origin `fetch()` calls with this — unlike
 * `next/link`/router navigation, a plain `fetch()` is NOT automatically
 * basePath-prefixed by Next.
 */
export const BASE_PATH = "/bureau";
