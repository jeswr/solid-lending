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
 * Create-once-write a Turtle resource for the one-shot disbursement receipt:
 * a payout that races (or repeats) against a GENUINE prior receipt must never
 * silently replace it (409, loud). This tolerates one specific, EXPECTED
 * prior state: the wallet's grant engine (`ensureResourcePlaceholder`,
 * `apps/wallet/lib/grants/engine.ts`) idempotently PUTs an EMPTY placeholder
 * at this exact path the moment `disbursementReceipt` is write-granted — WAC
 * evaluates a resource CREATE against the PARENT container, so a
 * not-yet-existing resource's own Write grant is otherwise inert. That
 * placeholder is not a receipt; a blind `If-None-Match: *` would 409 against
 * it on EVERY real payout, which is a bug, not idempotency. So: read first —
 * 404 strict-creates; a NON-EMPTY existing body is a genuine prior receipt
 * (409, no write attempted); an EMPTY existing body is the placeholder and is
 * safely replaced via `If-Match` on its own current ETag (still race-safe: a
 * concurrent write loses loudly, never silently).
 */
export async function createPodTurtle(
  iri: string,
  body: string,
  podFetch: typeof fetch,
): Promise<void> {
  let existing: Response;
  try {
    existing = await podFetch(iri, {
      headers: { accept: "text/turtle" },
      method: "GET",
      redirect: "error",
    });
  } catch {
    throw new PodAccessError(502, "could not reach the pod");
  }
  const headers: Record<string, string> = { "content-type": "text/turtle" };
  if (existing.status === 404) {
    headers["if-none-match"] = "*";
  } else if (existing.ok) {
    const priorBody = await existing.text();
    if (priorBody.trim() !== "") {
      throw new PodAccessError(409, "the disbursement receipt was already created concurrently");
    }
    const etag = existing.headers.get("etag");
    if (etag !== null) {
      // A concurrent real write racing this one still loses loudly below.
      headers["if-match"] = etag;
    }
    // No ETag on the empty placeholder: write unconditionally rather than
    // guessing wrong (matches the sibling apps' `writePodTurtle` fallback).
  } else {
    throw new PodAccessError(502, `pod read ${iri} failed: ${existing.status}`);
  }

  let response: Response;
  try {
    response = await podFetch(iri, {
      body,
      headers,
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
