/**
 * Minimal pod-IO helpers this app's server routes need beyond what
 * `@jeswr/solid-pod-guard`'s PUBLIC surface exposes (its `assertAllowedPodBase`
 * / `readPodResource` are internal to that package — only `PodAccessError`,
 * `createPodRouteGuard`, `createServicePodFetch`, `resolveAuthorizedPod`, and
 * `configFromEnv` are exported). Same fail-closed shape as the sibling apps'
 * equivalents (`pod_access` errors carry an explicit HTTP status, never a
 * silent default): an SSRF-allowlist check before any network IO, a
 * READ (n3-parsed, for the granted loan-offer document) and a STRICT-CREATE
 * write (for the one-shot disbursement receipt — a payout must never
 * silently overwrite a prior one) over an injected fetch (the service
 * identity's, never anonymous).
 */
import { PodAccessError } from "@jeswr/solid-pod-guard";
import type { PodGuardConfig } from "@jeswr/solid-pod-guard";
import type { DatasetCore } from "@rdfjs/types";
import { Parser, Store } from "n3";

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
  let response: Response;
  try {
    response = await podFetch(iri, {
      headers: { accept: "text/turtle" },
      method: "GET",
      redirect: "error",
    });
  } catch {
    throw new PodAccessError(502, "could not reach the pod");
  }
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

/** Whether a pod resource already exists at `iri` (404 -> false; other failures throw). */
export async function podResourceExists(iri: string, podFetch: typeof fetch): Promise<boolean> {
  let response: Response;
  try {
    response = await podFetch(iri, {
      headers: { accept: "text/turtle" },
      method: "GET",
      redirect: "error",
    });
  } catch {
    throw new PodAccessError(502, "could not reach the pod");
  }
  if (response.status === 404) return false;
  if (response.ok) return true;
  throw new PodAccessError(502, `pod read ${iri} failed: ${response.status}`);
}

/**
 * Strict-create a Turtle resource — NEVER overwrites. The disbursement
 * receipt is a one-shot fact: a payout that races (or repeats) must never
 * silently replace a prior receipt, so every write is `If-None-Match: *` and
 * a conflicting concurrent create loses loudly (409), not silently.
 */
export async function createPodTurtle(
  iri: string,
  body: string,
  podFetch: typeof fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await podFetch(iri, {
      body,
      headers: { "content-type": "text/turtle", "if-none-match": "*" },
      method: "PUT",
      redirect: "error",
    });
  } catch {
    throw new PodAccessError(502, "could not write to the pod");
  }
  if (response.status === 412) {
    throw new PodAccessError(409, "the disbursement receipt was already created concurrently");
  }
  if (!response.ok) {
    throw new PodAccessError(502, `pod write ${iri} failed: ${response.status}`);
  }
}
