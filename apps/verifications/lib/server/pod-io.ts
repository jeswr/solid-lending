/**
 * Minimal pod-write plumbing the issuer rail needs beyond what
 * @jeswr/solid-pod-guard exposes (it only ships the route-boundary + L4
 * service-fetch — reads/writes of the actual resources are an app concern).
 * No RDF parsing is needed here: existence is a plain GET status check, and
 * every write is a Turtle body this app itself produced via
 * `@lending/vc-kit`'s `issueCredential` (SHACL-gated before signing) — so
 * there is nothing to hand-parse or hand-build.
 */
import { PodAccessError } from "@jeswr/solid-pod-guard";

export type PodIoFetch = typeof fetch;

/** Whether a pod resource already exists at `iri` (404 -> false; other failures throw). */
export async function podResourceExists(iri: string, podFetch: PodIoFetch): Promise<boolean> {
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
  throw new PodAccessError(502, `pod read ${response.status}`);
}

/** Strict-create a Turtle resource (never overwrites). 409 on a conflicting write. */
export async function createPodTurtle(
  iri: string,
  body: string,
  podFetch: PodIoFetch,
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
    throw new PodAccessError(409, "the resource was created concurrently");
  }
  if (!response.ok) {
    throw new PodAccessError(502, `pod write ${response.status}`);
  }
}
