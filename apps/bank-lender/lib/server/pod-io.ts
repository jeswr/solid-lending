/**
 * Minimal pod-IO helpers this app's server routes need beyond what
 * `@jeswr/solid-pod-guard`'s PUBLIC surface exposes (its `assertAllowedPodBase`
 * / `readPodResource` are internal to that package — only `PodAccessError`,
 * `createPodRouteGuard`, `createServicePodFetch`, `resolveAuthorizedPod`, and
 * `configFromEnv` are exported). Same fail-closed shape as the sibling apps'
 * equivalents (`pod_access` errors carry an explicit HTTP status, never a
 * silent default): an SSRF-allowlist check before any network IO, a
 * conditional-write-safe read/write pair over an injected fetch (the service
 * identity's, never anonymous), and Turtle parsing through `n3` (this repo's
 * RDF toolchain — `@lending/data-model`'s own `validate()` uses the same
 * parser internally for a string input).
 */
import { PodAccessError } from "@jeswr/solid-pod-guard";
import type { DatasetCore } from "@rdfjs/types";
import { Parser, Store } from "n3";
import type { PodGuardConfig } from "@jeswr/solid-pod-guard";

/** Validate an untrusted pod base URL against the config allowlist; returns the normalised base. */
export function assertAllowedPodBase(pod: string, config: PodGuardConfig): string {
  let url: URL;
  try {
    url = new URL(pod);
  } catch {
    throw new PodAccessError(403, "pod base is not a valid absolute URL");
  }
  if (url.protocol !== "https:" && !config.allowInsecureLoopback) {
    throw new PodAccessError(403, "pod base must be https (loopback http only under dev config)");
  }
  if (!config.allowedPodOrigins.includes(url.origin)) {
    throw new PodAccessError(403, `pod origin ${url.origin} is not in the allowed-origins list`);
  }
  return pod.endsWith("/") ? pod : `${pod}/`;
}

export interface PodResource {
  readonly dataset: DatasetCore;
  readonly etag: string | null;
}

/** GET + parse one pod RDF resource over `podFetch`. 404 -> `undefined`; any other non-2xx throws. */
export async function readPodResource(
  iri: string,
  base: string,
  podFetch: typeof fetch,
): Promise<PodResource | undefined> {
  const response = await podFetch(iri, { headers: { accept: "text/turtle" } });
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new PodAccessError(
      response.status === 401 || response.status === 403 ? response.status : 502,
      `pod read ${iri} failed: ${response.status}`,
    );
  }
  const text = await response.text();
  const dataset: DatasetCore = new Store(
    new Parser({ baseIRI: base, format: "text/turtle" }).parse(text),
  );
  return { dataset, etag: response.headers.get("etag") };
}

/**
 * Conditional PUT of a Turtle document: `existing === undefined` (no prior
 * read found the resource) strict-creates (`If-None-Match: *`, so a lost
 * update racing a first write never silently clobbers); `existing` with a
 * known ETag replaces it (`If-Match`, so a lost update racing an overwrite
 * never clobbers either); `existing` with an unresolvable ETag (host did not
 * return one) writes without a precondition rather than guessing wrong.
 */
export async function writePodTurtle(
  iri: string,
  turtle: string,
  options: { readonly existing: PodResource | undefined; readonly podFetch: typeof fetch },
): Promise<void> {
  const headers: Record<string, string> = { "content-type": "text/turtle" };
  if (options.existing === undefined) {
    headers["if-none-match"] = "*";
  } else if (options.existing.etag !== null) {
    headers["if-match"] = options.existing.etag;
  }
  const response = await options.podFetch(iri, { body: turtle, headers, method: "PUT" });
  if (!response.ok) {
    throw new PodAccessError(
      response.status === 401 || response.status === 403 ? response.status : 502,
      `pod write ${iri} failed: ${response.status}`,
    );
  }
}
