/**
 * Normalize a pod base URL: PRESERVE any storage-root path (pods are not always
 * origin-rooted — `https://host/maya/` is a valid pod base) and end with exactly one
 * trailing slash. Shared by `./issuance.ts` and `./layout.ts` so both agree on the same
 * pod-root-relative -> absolute IRI resolution.
 */
export function normalizedPodBase(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error(`pod base URL must not carry credentials, a query, or a fragment: ${baseUrl}`);
  }
  url.pathname = url.pathname.replace(/\/*$/, "/");
  return url.href;
}
