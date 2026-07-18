/**
 * The vault's grant/revoke/ledger engine (design §6.2 "DPV consent receipts +
 * ODRL grants"), adapted from the solid-mortgage showcase's wallet engine
 * (`apps/wallet/lib/grants/engine.ts`, jeswr/solid-mortgage — read-only
 * reference; ISOMORPHIC state-machine pattern, roborev-hardened sm-28) to this
 * demo's RESOURCE-scoped grant model:
 *
 *   - "grant/revoke a lender read access to specific credentials" (the brief)
 *     is literal here: a transition targets exactly ONE pod resource
 *     (`./resources.ts`'s catalogue), not a whole container. Each resource's
 *     OWN ACL is rebuilt — `@jeswr/solid-seed` already provisions it
 *     owner-only at `${resourceIri}.acl` (see `seeds/layout.ts`), so the
 *     engine converges the SAME document rather than inventing a scheme.
 *
 *   - ACLs are REBUILT from per-agent single-agent rules: `#owner` (borrower,
 *     full control), optional `#service` (the wallet's Mode-2 service WebID),
 *     and one `#grant-…` rule per granted party, `acl:accessTo` only (these
 *     are plain resources, not containers — no `acl:default` needed).
 *
 *   - POLICY-BEARING receipts are UNFORGEABLE: a write grant on `loanOffer`/
 *     `disbursementReceipt`/`repaymentHistory` gives the granted party WAC
 *     Write on THAT resource only — never on the receipt ledger. The
 *     authoritative ledger lives in a DEDICATED `/lending/receipts/`
 *     subcontainer whose OWN ACL grants write to the borrower + the wallet's
 *     service identity ONLY (never any granted party). Grant/revoke POLICY
 *     reads run STRICT against that store (a transient dropout ABORTS the
 *     caller rather than silently shrinking history — a fail-open read would
 *     re-enable a revoked party); the DISPLAY ledger additionally shows other
 *     apps' root-level `/lending/consent-receipt-…` records TOLERANTLY
 *     (skip-and-surface, tagged `external` provenance).
 *
 *   - REVOCATION IS IMMUTABLE at the app level: once the protected store holds
 *     a withdraw receipt for (agent, resource), re-granting is refused (409).
 *     A REVOKE removes live WAC access BEFORE it touches the ledger, so
 *     nothing can block the borrower from cutting a party off.
 *
 *   - REPEAT operations are loud 409 no-ops (idempotent in effect).
 *
 *   - Fail-safe write ordering: REVOKE removes access, then records (a
 *     recording failure keeps access OFF and is retry-repairable); GRANT
 *     records after the ACL write and compensates surgically on receipt
 *     failure (re-checks whether a concurrent repair's DETERMINISTIC receipt
 *     already landed before rolling the ACL back).
 *
 *   - KNOWN RESIDUAL (single-instance demo scope, tracked as a beaded
 *     follow-up rather than silently built): the mortgage showcase's receipt
 *     store additionally closes a cross-instance create→lock race with a
 *     readiness sentinel (auto-scaling deploys racing the FIRST-EVER grant).
 *     This app runs one instance in dev/test/demo, so that race is not
 *     reachable here; the pre-existing-store lock is still verified (never
 *     trusted blindly), just without the sentinel dance.
 *
 * RDF discipline: ACL documents through `@solid/object` typed wrappers,
 * receipts through the data-model `buildConsentReceipt` wrapper (SHACL-gated
 * on read), the repayment-authorization ODRL document through `./odrl.ts`'s
 * typed wrappers. Serialisation only via `@jeswr/rdf-serialize`.
 */
import { serialize } from "@jeswr/rdf-serialize";
import {
  buildConsentReceipt,
  ConsentReceipt,
  DPV,
  resourceToTurtle,
  validate,
} from "@lending/data-model";
import type { Quad } from "@rdfjs/types";
import { AclResource, Authorization, ContainerDataset } from "@solid/object";
import { DataFactory, Store } from "n3";
import { buildRepaymentAuthorization, repaymentAuthorizationToTurtle } from "./odrl";
import { PodAccessError, type PodIoFetch, readPodResource, writePodTurtle } from "./pod-io";
import { type ResourceId, resourceIri } from "./resources";

export { PodAccessError } from "./pod-io";

const ACL = {
  Authorization: "http://www.w3.org/ns/auth/acl#Authorization",
  namespace: "http://www.w3.org/ns/auth/acl#",
} as const;

const RDF = { namespace: "http://www.w3.org/1999/02/22-rdf-syntax-ns#" } as const;

/** Cross-app root-level receipt prefix (other apps in the journey may write
 * their own `/lending/consent-receipt-…` records the display ledger surfaces
 * tolerantly, mirroring the mortgage showcase's cross-app ledger convention). */
const RECEIPT_PREFIX = "consent-receipt-";
const RECEIPTS_SUBCONTAINER = "lending/receipts/";
const VAULT_RECEIPT_PREFIX = "vault-";

/** The access modes a grant materialises (Read is always granted). */
export interface GrantModes {
  readonly write: boolean;
}

export interface ConsentReceiptView {
  readonly iri: string;
  readonly action: "grant" | "revoke";
  readonly actor: string;
  readonly recipient: string;
  readonly resource: string;
  readonly issuedAt: string;
  readonly provenance: "wallet" | "external";
}

/** One (agent, resource) pair's current standing, for the dashboard. */
export interface GrantStanding {
  readonly agent: string;
  readonly resource: ResourceId;
  readonly granted: boolean;
  readonly modes: readonly string[];
  readonly revoked: boolean;
}

export interface GrantEngineOptions {
  /** Mode 2: the wallet's DPoP-bound service identity. */
  readonly podFetch: PodIoFetch;
  /** Kept in every rebuilt ACL so the app never locks itself out. */
  readonly serviceWebId?: string;
  readonly now?: () => Date;
}

/** IN-PROCESS per-(pod,resource) serialization — see the module header's residual note. */
const transitionLocks = new Map<string, Promise<void>>();

function withTransitionLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = transitionLocks.get(key) ?? Promise.resolve();
  const next = previous.then(run, run);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  transitionLocks.set(key, settled);
  void settled.then(() => {
    if (transitionLocks.get(key) === settled) transitionLocks.delete(key);
  });
  return next;
}

export function lendingRootIri(podBase: string): string {
  return `${podBase}lending/`;
}

export function receiptsContainerIri(podBase: string): string {
  return `${podBase}${RECEIPTS_SUBCONTAINER}`;
}

function aclIriFor(target: string): string {
  return `${target}.acl`;
}

/**
 * Idempotently provision the protected `/lending/receipts/` store. Mirrors
 * the mortgage engine's `ensureReceiptsStore` (see module header for the
 * dropped cross-instance sentinel): a FRESH container is created then locked
 * to owner (+ service) with `acl:default` write; a PRE-EXISTING container is
 * verify-only — its lock must grant exactly owner (+service) member-covering
 * write, nothing else, or the store is refused (fail closed, never trusted).
 */
async function ensureReceiptsStore(
  podBase: string,
  ownerWebId: string,
  serviceWebId: string | undefined,
  podFetch: PodIoFetch,
): Promise<void> {
  const container = receiptsContainerIri(podBase);
  const iri = aclIriFor(container);
  const created = await podFetch(container, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: "",
    redirect: "error",
  });
  if (created.status === 412) {
    await verifyReceiptsLock(container, iri, ownerWebId, serviceWebId, podFetch);
    return;
  }
  if (!created.ok) {
    throw new PodAccessError(502, `could not provision the receipt store (${created.status})`);
  }
  const dataset = new Store();
  const owner = authorization(`${iri}#owner`, dataset, container, ownerWebId, true);
  owner.canRead = true;
  owner.canWrite = true;
  owner.canReadWriteAcl = true;
  if (serviceWebId !== undefined) {
    const service = authorization(`${iri}#service`, dataset, container, serviceWebId, true);
    service.canRead = true;
    service.canWrite = true;
    service.canReadWriteAcl = true;
  }
  const aclResponse = await podFetch(iri, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: await serializeAcl(dataset),
    redirect: "error",
  });
  if (aclResponse.ok) return;
  if (aclResponse.status === 412) {
    await verifyReceiptsLock(container, iri, ownerWebId, serviceWebId, podFetch);
    return;
  }
  throw new PodAccessError(502, `could not lock the receipt store (${aclResponse.status})`);
}

/**
 * Fail closed unless `/lending/receipts/.acl` grants access to the borrower +
 * wallet service ONLY — no public/authenticated class, no `acl:agentClass`,
 * no `acl:agentGroup`, no other `acl:agent`, every rule scoped to THIS
 * container. Read through the `@solid/object` typed wrappers (house rule).
 */
async function verifyReceiptsLock(
  containerIri: string,
  aclDocumentIri: string,
  ownerWebId: string,
  serviceWebId: string | undefined,
  podFetch: PodIoFetch,
): Promise<void> {
  const existing = await readPodResource(aclDocumentIri, containerIri, podFetch);
  if (existing === undefined) {
    throw new PodAccessError(
      409,
      "the consent-receipt store exists without its integrity lock — refusing to trust it; " +
        "reconcile it out of band before granting",
    );
  }
  const allowed = new Set([ownerWebId, ...(serviceWebId === undefined ? [] : [serviceWebId])]);
  const acl = new AclResource(new Store([...existing.dataset] as Quad[]), DataFactory);
  const untrusted = (detail: string): PodAccessError =>
    new PodAccessError(409, `the consent-receipt store lock is untrusted (${detail})`);
  let ownerCovered = false;
  let serviceCovered = serviceWebId === undefined;
  for (const rule of acl.authorizations) {
    if (rule.accessibleToAny || rule.accessibleToAuthenticated) {
      throw untrusted("grants public/authenticated access");
    }
    if (rule.agentClass.size > 0) throw untrusted("grants agentClass access");
    if (rule.agentGroup !== undefined) throw untrusted("grants agentGroup access");
    if (rule.accessTo !== undefined && rule.accessTo !== containerIri) {
      throw untrusted("names a foreign accessTo target");
    }
    if (rule.default !== undefined && rule.default !== containerIri) {
      throw untrusted("names a foreign default target");
    }
    if (rule.accessTo === undefined && rule.default === undefined) {
      throw untrusted("names no target");
    }
    for (const agent of rule.agent) {
      if (!allowed.has(agent)) throw untrusted("names an unexpected agent");
    }
    if (rule.default === containerIri && rule.canWrite) {
      if (rule.agent.has(ownerWebId)) ownerCovered = true;
      if (serviceWebId !== undefined && rule.agent.has(serviceWebId)) serviceCovered = true;
    }
  }
  if (!ownerCovered) throw untrusted("does not grant the borrower member-covering write");
  if (!serviceCovered) throw untrusted("does not grant the service member-covering write");
}

function authorization(
  iri: string,
  dataset: Store,
  target: string,
  agent: string,
  isContainer: boolean,
): Authorization {
  const rule = new Authorization(iri, dataset, DataFactory);
  rule.type.add(ACL.Authorization);
  rule.accessTo = target;
  // Container rules (the receipts store) additionally carry `acl:default` so
  // members inherit; plain-resource rules (every grantable credential/
  // document) use `accessTo` alone — there is nothing to inherit.
  if (isContainer) rule.default = target;
  rule.agent.add(agent);
  return rule;
}

async function serializeAcl(dataset: Store): Promise<string> {
  return serialize([...dataset] as Quad[], {
    prefixes: { acl: ACL.namespace, rdf: RDF.namespace },
  });
}

interface AclSnapshot {
  readonly etag: string | null | undefined;
  readonly granted: ReadonlyMap<string, readonly string[]>;
}

async function readAclSnapshot(
  targetIri: string,
  ownerWebId: string,
  serviceWebId: string | undefined,
  podFetch: PodIoFetch,
): Promise<AclSnapshot> {
  const existing = await readPodResource(aclIriFor(targetIri), targetIri, podFetch);
  if (existing === undefined) return { etag: undefined, granted: new Map() };
  const acl = new AclResource(new Store([...existing.dataset] as Quad[]), DataFactory);
  const granted = new Map<string, string[]>();
  for (const rule of acl.authorizations) {
    if (rule.accessTo !== targetIri || !rule.canRead) continue;
    for (const agent of rule.agent) {
      if (agent === ownerWebId || agent === serviceWebId) continue;
      const modes = granted.get(agent) ?? [];
      if (!modes.includes("read")) modes.push("read");
      if (rule.canWrite && !modes.includes("write")) modes.push("write");
      granted.set(agent, modes);
    }
  }
  return { etag: existing.etag, granted };
}

async function writeAclDocument(
  targetIri: string,
  ownerWebId: string,
  serviceWebId: string | undefined,
  granted: ReadonlyMap<string, readonly string[]>,
  etag: string | null | undefined,
  podFetch: PodIoFetch,
): Promise<void> {
  const dataset = new Store();
  const iri = aclIriFor(targetIri);
  const owner = authorization(`${iri}#owner`, dataset, targetIri, ownerWebId, false);
  owner.canRead = true;
  owner.canWrite = true;
  owner.canReadWriteAcl = true;
  if (serviceWebId !== undefined) {
    const service = authorization(`${iri}#service`, dataset, targetIri, serviceWebId, false);
    service.canRead = true;
    service.canWrite = true;
    service.canReadWriteAcl = true;
  }
  for (const agent of [...granted.keys()].sort()) {
    const rule = authorization(
      `${iri}#grant-${encodeURIComponent(agent)}`,
      dataset,
      targetIri,
      agent,
      false,
    );
    const modes = granted.get(agent) ?? [];
    rule.canRead = true;
    if (modes.includes("write")) rule.canWrite = true;
  }
  await writePodTurtle(iri, await serializeAcl(dataset), { etag, podFetch });
}

async function removeAgentFromAcl(
  targetIri: string,
  ownerWebId: string,
  serviceWebId: string | undefined,
  agentWebId: string,
  podFetch: PodIoFetch,
): Promise<void> {
  const snapshot = await readAclSnapshot(targetIri, ownerWebId, serviceWebId, podFetch);
  if (!snapshot.granted.has(agentWebId)) return;
  const granted = new Map(snapshot.granted);
  granted.delete(agentWebId);
  await writeAclDocument(targetIri, ownerWebId, serviceWebId, granted, snapshot.etag, podFetch);
}

function receiptView(
  iri: string,
  receipt: ConsentReceipt,
  provenance: "wallet" | "external" = "wallet",
): ConsentReceiptView {
  const status = receipt.consentStatus;
  if (status !== DPV.ConsentGiven && status !== DPV.ConsentWithdrawn) {
    throw new PodAccessError(502, `receipt ${iri} has an unsupported consent status`);
  }
  return {
    iri,
    action: status === DPV.ConsentGiven ? "grant" : "revoke",
    actor: receipt.dataSubjectIri,
    recipient: receipt.dataControllerIri,
    resource: receipt.targetIri,
    issuedAt: receipt.issued.toISOString(),
    provenance,
  };
}

function receiptIriFor(
  podBase: string,
  resource: ResourceId,
  action: "grant" | "revoke",
  sequence: number,
  recipient: string,
): string {
  return `${receiptsContainerIri(podBase)}${VAULT_RECEIPT_PREFIX}${resource}-${sequence}-${action}-${encodeURIComponent(recipient)}`;
}

async function writeReceipt(
  podBase: string,
  actor: string,
  recipient: string,
  resource: ResourceId,
  targetIri: string,
  action: "grant" | "revoke",
  sequence: number,
  options: GrantEngineOptions,
): Promise<ConsentReceiptView> {
  const now = options.now?.() ?? new Date();
  const iri = receiptIriFor(podBase, resource, action, sequence, recipient);
  const receipt = buildConsentReceipt({
    iri,
    dataSubject: actor,
    dataController: recipient,
    target: targetIri,
    consentStatus: action === "grant" ? DPV.ConsentGiven : DPV.ConsentWithdrawn,
    issued: now,
  });
  await writePodTurtle(iri, await resourceToTurtle(receipt), {
    etag: undefined,
    podFetch: options.podFetch,
  });
  return receiptView(iri, receipt);
}

/** Idempotently write the repayment-authorization ODRL policy document (once,
 * on the first grant of that resource — never rewritten on repair/retry). */
async function ensureRepaymentAuthorizationDocument(
  podBase: string,
  borrowerWebId: string,
  fintechLenderWebId: string,
  podFetch: PodIoFetch,
): Promise<void> {
  const iri = resourceIri(podBase, "repaymentAuthorization");
  const { dataset } = buildRepaymentAuthorization({
    iri,
    assigner: borrowerWebId,
    assignee: fintechLenderWebId,
    targetIri: resourceIri(podBase, "loanOffer"),
    maxFailedAttempts: 2,
  });
  const response = await podFetch(iri, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: await repaymentAuthorizationToTurtle(dataset),
    redirect: "error",
  });
  if (!response.ok && response.status !== 412) {
    throw new PodAccessError(
      502,
      `could not write the repayment-authorization document (${response.status})`,
    );
  }
}

/** Idempotently create an EMPTY placeholder at `targetIri` if it does not
 * already exist (see the grant-path comment: WAC evaluates a resource CREATE
 * against the parent container, not the not-yet-existing resource's own
 * ACL). A 412 (already exists) is the ordinary case, not a fault. */
async function ensureResourcePlaceholder(targetIri: string, podFetch: PodIoFetch): Promise<void> {
  const response = await podFetch(targetIri, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-none-match": "*" },
    body: "",
    redirect: "error",
  });
  if (!response.ok && response.status !== 412) {
    throw new PodAccessError(502, `could not provision ${targetIri} (${response.status})`);
  }
}

/**
 * Grant or revoke `agentWebId`'s access to ONE catalogue resource, with the
 * matching DPV receipt. State model in the module header.
 */
export function changeResourceAccess(
  podBase: string,
  borrowerWebId: string,
  agentWebId: string,
  resource: ResourceId,
  action: "grant" | "revoke",
  modes: GrantModes,
  options: GrantEngineOptions,
): Promise<ConsentReceiptView> {
  return withTransitionLock(`${podBase} ${resource}`, () =>
    changeResourceAccessSerialized(
      podBase,
      borrowerWebId,
      agentWebId,
      resource,
      action,
      modes,
      options,
    ),
  );
}

async function changeResourceAccessSerialized(
  podBase: string,
  borrowerWebId: string,
  agentWebId: string,
  resource: ResourceId,
  action: "grant" | "revoke",
  modes: GrantModes,
  options: GrantEngineOptions,
): Promise<ConsentReceiptView> {
  const targetIri = resourceIri(podBase, resource);
  const snapshot = await readAclSnapshot(
    targetIri,
    borrowerWebId,
    options.serviceWebId,
    options.podFetch,
  );
  const isGranted = snapshot.granted.has(agentWebId);

  if (action === "revoke") {
    if (isGranted) {
      const granted = new Map(snapshot.granted);
      granted.delete(agentWebId);
      await writeAclDocument(
        targetIri,
        borrowerWebId,
        options.serviceWebId,
        granted,
        snapshot.etag,
        options.podFetch,
      );
    }
    await ensureReceiptsStore(podBase, borrowerWebId, options.serviceWebId, options.podFetch);
    const history = await policyHistoryFor(podBase, borrowerWebId, resource, agentWebId, options);
    const everRevoked = history.some((receipt) => receipt.action === "revoke");
    const everGranted = history.some((receipt) => receipt.action === "grant");
    if (!isGranted && everRevoked) {
      throw new PodAccessError(409, "access is already revoked and recorded");
    }
    if (!isGranted && !everGranted) {
      throw new PodAccessError(
        409,
        "no grant exists for this party, so there is nothing to revoke",
      );
    }
    return writeReceipt(
      podBase,
      borrowerWebId,
      agentWebId,
      resource,
      targetIri,
      "revoke",
      history.length,
      options,
    );
  }

  // action === "grant".
  await ensureReceiptsStore(podBase, borrowerWebId, options.serviceWebId, options.podFetch);
  const history = await policyHistoryFor(podBase, borrowerWebId, resource, agentWebId, options);
  const everRevoked = history.some((receipt) => receipt.action === "revoke");
  const everGranted = history.some((receipt) => receipt.action === "grant");

  if (everRevoked) {
    throw new PodAccessError(
      409,
      "revocation is immutable: this party's access was withdrawn by the borrower and is " +
        "never silently re-granted",
    );
  }
  if (isGranted && everGranted) {
    throw new PodAccessError(409, "access is already granted and recorded");
  }
  if (resource === "repaymentAuthorization") {
    await ensureRepaymentAuthorizationDocument(
      podBase,
      borrowerWebId,
      agentWebId,
      options.podFetch,
    );
  }
  if (modes.write) {
    // WAC evaluates a resource CREATE (a PUT to an IRI that does not yet
    // exist) against the PARENT CONTAINER's own permissions, not the
    // not-yet-existing resource's own ACL — a resource-level Write grant is
    // otherwise inert until some OTHER writer creates the resource first.
    // The scene-3/4/5 write-target documents (loan offer, disbursement
    // receipt, repayment history) are not seeded up front (the seeder only
    // issues the five scene-1 credentials), so a write grant idempotently
    // provisions an EMPTY placeholder here — least-privilege intact (the
    // grantee still only ever gets resource-level Write, never container
    // access) and the grant is immediately effective regardless of whether
    // the resource already exists.
    await ensureResourcePlaceholder(targetIri, options.podFetch);
  }
  if (!isGranted) {
    const granted = new Map(snapshot.granted);
    const grantedModes = ["read", ...(modes.write ? ["write"] : [])];
    granted.set(agentWebId, grantedModes);
    await writeAclDocument(
      targetIri,
      borrowerWebId,
      options.serviceWebId,
      granted,
      snapshot.etag,
      options.podFetch,
    );
  }
  try {
    return await writeReceipt(
      podBase,
      borrowerWebId,
      agentWebId,
      resource,
      targetIri,
      "grant",
      history.length,
      options,
    );
  } catch (error) {
    if (!isGranted) {
      const transitionIri = receiptIriFor(podBase, resource, "grant", history.length, agentWebId);
      try {
        const recorded = await readPodResource(transitionIri, podBase, options.podFetch);
        if (recorded !== undefined) {
          const report = await validate(recorded.dataset, {
            expect: "consent-receipt",
            focusNode: transitionIri,
          });
          if (report.conforms) {
            const view = receiptView(
              transitionIri,
              new ConsentReceipt(transitionIri, recorded.dataset, DataFactory),
            );
            if (
              view.action === "grant" &&
              view.actor === borrowerWebId &&
              view.recipient === agentWebId &&
              view.resource === targetIri
            ) {
              return view;
            }
          }
        }
      } catch {
        // Could not tell — fall through to the fail-safe rollback below.
      }
      try {
        await removeAgentFromAcl(
          targetIri,
          borrowerWebId,
          options.serviceWebId,
          agentWebId,
          options.podFetch,
        );
      } catch {
        // Rollback failed too: applied-but-unrecorded; a retry lands the repair branch.
      }
    }
    throw error;
  }
}

async function policyHistoryFor(
  podBase: string,
  borrowerWebId: string,
  resource: ResourceId,
  agentWebId: string,
  options: GrantEngineOptions,
): Promise<readonly ConsentReceiptView[]> {
  const history = await readPolicyHistory(podBase, borrowerWebId, resource, options, true);
  return history.filter((receipt) => receipt.recipient === agentWebId);
}

/** The dashboard view: every (agent, resource) combination the catalogue
 * permits that currently holds a rule OR appears in the authoritative history. */
export async function readGrantStandings(
  podBase: string,
  borrowerWebId: string,
  resources: readonly ResourceId[],
  options: GrantEngineOptions,
): Promise<readonly GrantStanding[]> {
  const standings: GrantStanding[] = [];
  for (const resource of resources) {
    const targetIri = resourceIri(podBase, resource);
    const [history, snapshot] = await Promise.all([
      readPolicyHistory(podBase, borrowerWebId, resource, options),
      readAclSnapshot(targetIri, borrowerWebId, options.serviceWebId, options.podFetch),
    ]);
    const agents = new Set<string>(snapshot.granted.keys());
    for (const receipt of history) agents.add(receipt.recipient);
    for (const agent of [...agents].sort()) {
      standings.push({
        agent,
        resource,
        granted: snapshot.granted.has(agent),
        modes: snapshot.granted.get(agent) ?? [],
        revoked: history.some(
          (receipt) => receipt.recipient === agent && receipt.action === "revoke",
        ),
      });
    }
  }
  return standings;
}

async function readReceiptsFrom(
  listIri: string,
  prefixes: readonly string[],
  provenance: "wallet" | "external",
  mode: "strict" | "tolerant",
  requireContainer: boolean,
  podBase: string,
  borrowerWebId: string,
  options: GrantEngineOptions,
): Promise<ConsentReceiptView[]> {
  const resource = await readPodResource(listIri, podBase, options.podFetch);
  if (resource === undefined) {
    if (requireContainer) {
      throw new PodAccessError(502, "the just-provisioned receipt store is unexpectedly absent");
    }
    return [];
  }
  const container = new ContainerDataset(resource.dataset, DataFactory).container;
  if (container === undefined) return [];
  const receiptIris = [...container.contains]
    .map((entry) => entry.value)
    .filter((iri) => prefixes.some((prefix) => iri.startsWith(`${listIri}${prefix}`)));
  const views = await Promise.all(
    receiptIris.map(async (iri): Promise<ConsentReceiptView | undefined> => {
      try {
        const stored = await readPodResource(iri, podBase, options.podFetch);
        if (stored === undefined) {
          if (mode === "strict") {
            throw new PodAccessError(502, `protected receipt ${iri} is listed but missing`);
          }
          return undefined;
        }
        const report = await validate(stored.dataset, {
          expect: "consent-receipt",
          focusNode: iri,
        });
        if (!report.conforms) {
          if (mode === "strict")
            throw new PodAccessError(502, `protected receipt ${iri} fails SHACL`);
          return undefined;
        }
        const receipt = new ConsentReceipt(iri, stored.dataset, DataFactory);
        if (receipt.dataSubjectIri !== borrowerWebId) {
          if (mode === "strict") {
            throw new PodAccessError(502, `protected receipt ${iri} names another data subject`);
          }
          return undefined;
        }
        return receiptView(iri, receipt, provenance);
      } catch (error) {
        if (mode === "strict") {
          throw error instanceof PodAccessError
            ? error
            : new PodAccessError(502, `protected receipt ${iri} could not be read`);
        }
        return undefined;
      }
    }),
  );
  return views.filter((view): view is ConsentReceiptView => view !== undefined);
}

async function readPolicyHistory(
  podBase: string,
  borrowerWebId: string,
  resource: ResourceId,
  options: GrantEngineOptions,
  requireStore = false,
): Promise<readonly ConsentReceiptView[]> {
  const listIri = receiptsContainerIri(podBase);
  const views = await readReceiptsFrom(
    listIri,
    [`${VAULT_RECEIPT_PREFIX}${resource}-`],
    "wallet",
    "strict",
    requireStore,
    podBase,
    borrowerWebId,
    options,
  );
  const targetIri = resourceIri(podBase, resource);
  const prefix = `${VAULT_RECEIPT_PREFIX}${resource}-`;
  const authoritative = views.filter((view) => {
    if (view.resource !== targetIri) return false;
    const suffix = view.iri.slice(listIri.length);
    if (!suffix.startsWith(prefix)) return false;
    const rest = suffix.slice(prefix.length);
    const match = /^(\d+)-(grant|revoke)-(.+)$/.exec(rest);
    if (match === null) return false;
    const [, sequence, action, recipient] = match;
    return (
      action === view.action &&
      recipient === encodeURIComponent(view.recipient) &&
      view.iri === receiptIriFor(podBase, resource, view.action, Number(sequence), view.recipient)
    );
  });
  return authoritative.sort(
    (left, right) =>
      left.issuedAt.localeCompare(right.issuedAt) || left.iri.localeCompare(right.iri),
  );
}

/** The scene-5 DISPLAY ledger: the wallet's authoritative `/lending/receipts/`
 * records PLUS any root-level `/lending/consent-receipt-…` written by other
 * apps, all SHACL-validated, subject-checked, time-ordered; untrusted/foreign
 * entries are skipped rather than thrown. */
export async function readConsentLedger(
  podBase: string,
  borrowerWebId: string,
  options: GrantEngineOptions,
): Promise<readonly ConsentReceiptView[]> {
  const [vault, root] = await Promise.all([
    readReceiptsFrom(
      receiptsContainerIri(podBase),
      [VAULT_RECEIPT_PREFIX],
      "wallet",
      "tolerant",
      false,
      podBase,
      borrowerWebId,
      options,
    ),
    readReceiptsFrom(
      lendingRootIri(podBase),
      [RECEIPT_PREFIX],
      "external",
      "tolerant",
      false,
      podBase,
      borrowerWebId,
      options,
    ),
  ]);
  return [...vault, ...root].sort(
    (left, right) =>
      left.issuedAt.localeCompare(right.issuedAt) || left.iri.localeCompare(right.iri),
  );
}

export { RESOURCE_CATALOG, type ResourceId, resourceIri } from "./resources";
