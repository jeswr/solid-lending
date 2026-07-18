/**
 * Small pod-IO primitives the grant/revoke engine needs beyond
 * `@jeswr/solid-pod-guard`'s public surface: that package exposes
 * `PodAccessError` at its root, but `PodIoFetch`/`anonymousPodFetch`/
 * `readPodResource` are internal to its `pod.js` module (not re-exported —
 * see its `dist/index.d.ts`). This module reproduces them verbatim (the
 * mortgage showcase's own `lib/server/pod.ts` counterpart, which pod-guard's
 * SKILL.md documents as the extraction source) plus the write helper the
 * package never shipped (writes are app-specific).
 */
import { fetchRdf, RdfFetchError } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { PodAccessError } from "@jeswr/solid-pod-guard";

export { PodAccessError } from "@jeswr/solid-pod-guard";

/** The pod-IO fetch. Redirect-refusing always — an allowlisted origin must
 * not bounce us out of the boundary. */
export type PodIoFetch = typeof fetch;

/** The default (ANONYMOUS) pod-IO fetch — redirect-refusing. */
export function anonymousPodFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, redirect: "error" });
}

export interface PodResource {
  readonly dataset: DatasetCore;
  readonly etag: string | null;
}

/** GET+parse one pod RDF resource. 404 -> `undefined`; other failures throw. */
export async function readPodResource(
  iri: string,
  base: string,
  podFetch: PodIoFetch = anonymousPodFetch,
): Promise<PodResource | undefined> {
  try {
    const { dataset, etag } = await fetchRdf(iri, {
      fetch: (input, init) => podFetch(input, { ...init, redirect: "error" }),
    });
    return { dataset, etag };
  } catch (error) {
    if (error instanceof RdfFetchError && error.status === 404) return undefined;
    console.warn(
      `[wallet] pod read failed for ${iri.replace(base, "<pod>/")}: ${(error as Error).message}`,
    );
    throw new PodAccessError(502, `could not read ${iri.replace(base, "<pod>/")}`);
  }
}

export async function writePodTurtle(
  iri: string,
  turtle: string,
  options: { readonly etag: string | null | undefined; readonly podFetch?: PodIoFetch },
): Promise<void> {
  const headers: Record<string, string> = { "content-type": "text/turtle" };
  if (options.etag !== null && options.etag !== undefined) headers["if-match"] = options.etag;
  else headers["if-none-match"] = "*";
  const podFetch = options.podFetch ?? anonymousPodFetch;
  const response = await podFetch(iri, {
    method: "PUT",
    headers,
    body: turtle,
    redirect: "error",
  });
  if (!response.ok) {
    throw new PodAccessError(502, `pod write to ${iri} failed with ${response.status}`);
  }
}
