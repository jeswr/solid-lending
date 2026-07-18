/**
 * The `@lending/vc-kit`-backed issuance for the lending seeder: real
 * `eddsa-rdfc-2022` signing (`issueCredential`), fresh Ed25519 issuer keys hosted at
 * pod-relative WebID documents, per-issuer Bitstring status lists, and the standards-rail
 * ZK operand anchors (issued through the SAME `issueCredential` gate, carrying the
 * captured genuine `encode_int_literal` output pinned on each scripted anchor spec — see
 * `./captured-operand-enc.ts`). NEVER stubbed: every credential and anchor this module
 * emits is a real signed VC that passes `verifyCredential`'s full fail-closed gate chain
 * against the documents it also emits (`issuerResources`).
 *
 * Deliberately imports ONLY `@lending/vc-kit`'s package root, never its `./seed-tooling`
 * subpath (`mintOperandAnchors`/`SparqNativeBridge`): that subpath's Node-only native
 * bridge resolves a filesystem path via `new URL(..., import.meta.url)`, which
 * Turbopack/webpack misreads as an unresolvable module import the instant an app bundles
 * this module — exactly the reason solid-mortgage's own wallet Mode-1 worker
 * (`apps/wallet/lib/pod/seed.ts`) mints its anchors directly through `issueCredential`
 * too. See `./captured-operand-enc.ts`'s header for the full note (reported for beading).
 *
 * NODE-ONLY (`node:buffer`, and `@lending/vc-kit`'s `StatusListClient` uses `node:crypto`
 * `createHash`) — the three call sites that import this module (dev-pod script, e2e
 * global-setup, the wallet's dev-gated Mode-1 seed route) all run in a Node runtime, never
 * a browser bundle.
 */
import { Buffer } from "node:buffer";
import {
  type CredentialClaims,
  generateKeyPairForSuite,
  issueCredential,
  type KeyPair,
  MIN_STATUS_LIST_LENGTH,
  publishVerificationMethod,
  StatusListClient,
} from "@lending/vc-kit";
import {
  ISSUER_ROLES,
  type LendingSeedIssuerRole,
  type ScriptedAnchorSeed,
  type ScriptedCredentialSeed,
  anchorValidity,
} from "./credentials.ts";
import { normalizedPodBase } from "./pod-base.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** In-memory GET/PUT host so signed status-list bodies can be captured as seed fixtures
 * before the pod resources exist (the wallet Mode-1 pattern — resources are written by
 * `@jeswr/solid-seed` afterwards, in one manifest-tracked pass). */
function memoryResourceStore(): {
  fetch: typeof fetch;
  body(url: string): { body: string; contentType: string };
} {
  const resources = new Map<string, { body: string; contentType: string; version: number }>();
  const memoryFetch: typeof fetch = async (input, init) => {
    const request = new Request(input instanceof Request ? input : String(input), init);
    const key = new URL(request.url).href;
    const existing = resources.get(key);
    if (request.method === "PUT") {
      if (request.headers.get("if-none-match") === "*" && existing !== undefined) {
        return new Response(null, { status: 412 });
      }
      const ifMatch = request.headers.get("if-match");
      if (ifMatch !== null && `"v${existing?.version ?? 0}"` !== ifMatch) {
        return new Response(null, { status: 412 });
      }
      const body = await request.text();
      resources.set(key, {
        body,
        contentType: request.headers.get("content-type") ?? "application/octet-stream",
        version: (existing?.version ?? 0) + 1,
      });
      return new Response(null, { status: existing === undefined ? 201 : 204 });
    }
    if (existing === undefined) return new Response("not found", { status: 404 });
    return new Response(existing.body, {
      status: 200,
      headers: { "content-type": existing.contentType, etag: `"v${existing.version}"` },
    });
  };
  return {
    fetch: memoryFetch,
    body(url: string) {
      const stored = resources.get(new URL(url).href);
      if (stored === undefined) throw new Error(`status list was never written: ${url}`);
      return { body: stored.body, contentType: stored.contentType };
    },
  };
}

interface SeedIssuer {
  readonly iri: string;
  readonly key: KeyPair;
  readonly status: StatusListClient;
  readonly docPath: string;
  readonly docBody: string;
  readonly statusPath: string;
  readonly finishStatusFixture: () => { path: string; body: string; contentType: string };
}

export interface LendingIssuanceContext {
  readonly webid: string;
  /** Absolute resource IRI for a pod-BASE-relative path (base path preserved). */
  resolve(path: string): string;
}

/** One issued pod resource body (a `{ body, contentType }` solid-seed `DataSource`). */
export interface SeedResourceBody {
  readonly body: string;
  readonly contentType: string;
}

/** A seeded operand anchor: the signed VC plus its emission metadata. */
export interface SeededAnchorResource extends SeedResourceBody {
  readonly path: string;
  readonly field: string;
  readonly operandEnc: string;
}

/** Everything one scripted-credential issuance materialises (one group). */
export interface SeededCredentialGroup {
  readonly vc: SeedResourceBody;
  readonly anchors: readonly SeededAnchorResource[];
}

/** The injected issuance seam: `layout.ts` calls `issue()` once per scripted credential
 * (materialising the VC + its operand anchor(s) together, so they stay consistent) and
 * `issuerResources()` once, AFTER every `issue()`, to collect the final issuer documents. */
export interface LendingCredentialIssuance {
  issue(
    spec: ScriptedCredentialSeed,
    context: LendingIssuanceContext,
  ): Promise<SeededCredentialGroup>;
  issuerResources(
    context: LendingIssuanceContext,
  ): Promise<readonly ({ readonly path: string } & SeedResourceBody)[]>;
}

export interface CreateLendingIssuanceOptions {
  /** Pod BASE URL hosting the issuer documents + status lists (an origin, or an origin +
   * storage-root path — any path is PRESERVED in the issuer IRIs). */
  readonly podOrigin: string;
  /** The demo reference instant (drives status-list windows and anchor validity). */
  readonly now: Date;
}

/**
 * Build the vc-kit-backed issuance for one pod. Issuer keys are freshly generated per
 * seed run (honest for per-boot demo pods — no cross-run issuer identity exists, and no
 * private key is ever committed).
 */
export function createLendingIssuance(
  options: CreateLendingIssuanceOptions,
): LendingCredentialIssuance {
  // Storage-root path preserved; trailing slash dropped so `${podRoot}${"/x"}` joins
  // cleanly with the pod-base-relative issuer paths.
  const podRoot = normalizedPodBase(options.podOrigin).slice(0, -1);
  const issuers = new Map<LendingSeedIssuerRole, Promise<SeedIssuer>>();

  async function provisionIssuer(role: LendingSeedIssuerRole): Promise<SeedIssuer> {
    const definition = ISSUER_ROLES[role];
    const iri = `${podRoot}${definition.docPath}`;
    const key = await generateKeyPairForSuite(`${iri}#key-1`, "Ed25519");
    const published = await publishVerificationMethod({ controller: iri, key });
    const store = memoryResourceStore();
    const statusUrl = `${podRoot}${definition.statusPath}`;
    const status = new StatusListClient({ url: statusUrl, issuer: iri, key, fetch: store.fetch });
    await status.create({
      now: options.now,
      validUntil: new Date(options.now.getTime() + 180 * DAY_MS),
      bits: Buffer.alloc(MIN_STATUS_LIST_LENGTH / 8),
    });
    return {
      iri,
      key,
      status,
      docPath: definition.docPath,
      docBody: published.turtle,
      statusPath: definition.statusPath,
      finishStatusFixture: () => {
        const captured = store.body(statusUrl);
        return {
          path: definition.statusPath,
          body: captured.body,
          contentType: captured.contentType,
        };
      },
    };
  }

  function issuerFor(role: LendingSeedIssuerRole): Promise<SeedIssuer> {
    let issuer = issuers.get(role);
    if (issuer === undefined) {
      issuer = provisionIssuer(role);
      issuers.set(role, issuer);
    }
    return issuer;
  }

  /**
   * Mint one `lend:ZkOperandAnchor` VC through the ordinary vc-kit issuance gate
   * (SHACL-validated, `eddsa-rdfc-2022`), carrying the anchor spec's pinned CAPTURED
   * operand encoding — the same claim value the credential it anchors just issued with,
   * so no drift is possible within one seeding call.
   */
  async function mintAnchor(
    anchor: ScriptedAnchorSeed,
    context: LendingIssuanceContext,
    issuer: SeedIssuer,
  ): Promise<SeededAnchorResource> {
    const anchorCredential = await issueCredential({
      kind: "zk-operand-anchor",
      credentialId: context.resolve(anchor.path),
      issuer: issuer.iri,
      subject: context.webid,
      claims: { kind: "zk-operand-anchor", field: anchor.field, operandEnc: anchor.operandEnc },
      validity: anchorValidity(options.now),
      status: issuer.status.entry(anchor.statusIndex),
      key: issuer.key,
    });
    return {
      path: anchor.path,
      field: anchor.field,
      operandEnc: anchor.operandEnc,
      body: anchorCredential.body,
      contentType: anchorCredential.contentType,
    };
  }

  return {
    async issue(spec, context) {
      const issuer = await issuerFor(spec.issuerRole);
      const claims: CredentialClaims = spec.claims;
      const credential = await issueCredential({
        kind: spec.kind,
        credentialId: context.resolve(spec.path),
        issuer: issuer.iri,
        subject: context.webid,
        claims,
        validity: { validFrom: spec.validFrom, validUntil: spec.validUntil },
        status: issuer.status.entry(spec.statusIndex),
        key: issuer.key,
      });
      const anchors: SeededAnchorResource[] = [];
      if (spec.anchor !== undefined) {
        anchors.push(await mintAnchor(spec.anchor, context, issuer));
      }
      return { vc: { body: credential.body, contentType: credential.contentType }, anchors };
    },
    async issuerResources() {
      const provisioned = await Promise.all([...issuers.values()]);
      if (provisioned.length === 0) {
        throw new Error("no issuer was provisioned — issue() must run before issuerResources()");
      }
      return provisioned.flatMap((issuer) => [
        { path: issuer.docPath, body: issuer.docBody, contentType: "text/turtle" },
        issuer.finishStatusFixture(),
      ]);
    },
  };
}
