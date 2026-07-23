/**
 * Publish a FRESH, genuinely resolvable trusted issuer on the journey's own
 * seeded pod — a real WebID document (`publishVerificationMethod`) and a
 * real hosted Bitstring status list, both public-read, exactly like the
 * seeder's own issuer seats. Mirrors `apps/bank-lender/test/pod-auth.test.ts`'s
 * `publishTestIssuer` helper (same recipe, hoisted for cross-app reuse):
 * used for scene 1's "fresh identity re-issue" flow and for lenders whose
 * own writes (loan offer, disbursement receipt) need a real signing
 * identity a downstream verifier can dereference.
 */
import { publicReadAcl } from "@lending/test-kit";
import {
  generateKeyPairForSuite,
  type KeyPair,
  MIN_STATUS_LIST_LENGTH,
  publishVerificationMethod,
  StatusListClient,
} from "@lending/vc-kit";

export interface ProvisionedIssuer {
  readonly webId: string;
  readonly key: KeyPair;
  readonly status: StatusListClient;
}

export interface ProvisionPodHostedIssuerOptions {
  readonly podOrigin: string;
  /** Root-relative document path, e.g. `/lending/issuers/fresh-identity`. */
  readonly docPath: string;
  /** Root-relative status-list path, e.g. `/lending/status/fresh-identity`. */
  readonly statusPath: string;
  readonly now: Date;
  /** The pod owner's WebID — granted Read/Write/Control over every ACL this mints. */
  readonly ownerWebId: string;
  /**
   * An authenticated fetch with owner-level Write+Control over the pod (the
   * seed-time owner fetch, NOT a per-scene service identity) — this
   * provisions the issuer's OWN public documents, not scene data.
   */
  readonly ownerFetch: typeof fetch;
}

export async function provisionPodHostedIssuer(
  options: ProvisionPodHostedIssuerOptions,
): Promise<ProvisionedIssuer> {
  const { docPath, now, ownerFetch, ownerWebId, podOrigin, statusPath } = options;
  const webId = `${podOrigin}${docPath}`;
  const key = await generateKeyPairForSuite(`${webId}#key-1`, "Ed25519");
  const published = await publishVerificationMethod({ controller: webId, key });

  const docPut = await ownerFetch(webId, {
    body: published.turtle,
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!docPut.ok) throw new Error(`issuer doc PUT ${webId} failed: ${docPut.status}`);
  const docAcl = await ownerFetch(`${webId}.acl`, {
    body: publicReadAcl(docPath, ownerWebId),
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!docAcl.ok) throw new Error(`issuer doc ACL PUT ${webId} failed: ${docAcl.status}`);

  const statusUrl = `${podOrigin}${statusPath}`;
  const status = new StatusListClient({ fetch: ownerFetch, issuer: webId, key, url: statusUrl });
  await status.create({ bits: Buffer.alloc(MIN_STATUS_LIST_LENGTH / 8), now });
  const statusAcl = await ownerFetch(`${statusUrl}.acl`, {
    body: publicReadAcl(statusPath, ownerWebId),
    headers: { "content-type": "text/turtle" },
    method: "PUT",
  });
  if (!statusAcl.ok)
    throw new Error(`issuer status ACL PUT ${statusUrl} failed: ${statusAcl.status}`);

  return { key, status, webId };
}
