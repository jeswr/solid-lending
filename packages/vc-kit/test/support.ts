/**
 * Shared test rig: fixed instants (the library never reads the clock, so the
 * suite doesn't either), a deterministic issuer key, an in-memory HTTP host
 * for status lists, and valid claim fixtures per credential kind.
 */

import { generateKeyPairForSuite, type KeyPair } from "@jeswr/solid-vc";
import type { DatasetCore } from "@rdfjs/types";
import { Parser, Store } from "n3";
import type {
  CredentialClaims,
  CredentialKind,
  DisbursementReceiptClaims,
  IdentityClaims,
  IssuedCredential,
  RepaymentHistoryClaims,
  ZkOperandAnchorClaims,
} from "../src/index.ts";
import { issueCredential, StatusListClient } from "../src/index.ts";
// The canonical demo-persona values live in src/seed-tooling/demo.ts so the
// capture script and this rig can never drift.
import {
  DAY_MS,
  DEMO_BACKDATED_VALIDITY,
  DEMO_INCOME_CREDENTIAL_ID,
  DEMO_ISSUER,
  DEMO_NOW,
  DEMO_STATUS_LIST_URL,
  DEMO_SUBJECT,
  demoEmploymentClaims,
} from "../src/seed-tooling/demo.ts";

export {
  demoBankCashFlowClaims as bankCashFlowClaims,
  demoCashFlowScoreClaims as cashFlowScoreClaims,
  demoCreditScoreClaims as creditScoreClaims,
  demoEmploymentClaims as employmentClaims,
  demoLoanOfferClaims as loanOfferClaims,
} from "../src/seed-tooling/demo.ts";
export { DAY_MS };
/** The suite's "wall clock" — explicit everywhere. */
export const NOW = DEMO_NOW;
/** Backdated freshness window: -30d .. +14d around NOW. */
export const BACKDATED_VALIDITY = DEMO_BACKDATED_VALIDITY;

export const ISSUER = DEMO_ISSUER;
export const KEY_ID = `${ISSUER}#key-1`;
export const SUBJECT = DEMO_SUBJECT;
export const LIST_URL = DEMO_STATUS_LIST_URL;
export const CREDENTIAL_ID = DEMO_INCOME_CREDENTIAL_ID;

let cachedKey: Promise<KeyPair> | undefined;
/** One deterministic-enough Ed25519 issuer key per suite run. */
export function issuerKey(): Promise<KeyPair> {
  cachedKey ??= generateKeyPairForSuite(KEY_ID, "Ed25519");
  return cachedKey;
}

/** `resolveKey` stub: exactly the issuer key, fail-closed for anything else. */
export async function resolveIssuerKey(verificationMethod: string): Promise<CryptoKey | undefined> {
  const key = await issuerKey();
  return verificationMethod === key.verificationMethod ? key.publicKey : undefined;
}

export interface StubHost {
  readonly fetch: typeof fetch;
  readonly resources: Map<string, { body: string; contentType: string; version: number }>;
}

/**
 * A tiny in-memory resource host honouring GET / PUT with `ETag`,
 * `If-None-Match: *` and `If-Match` — the surface StatusListClient uses.
 */
export function stubHost(): StubHost {
  const resources = new Map<string, { body: string; contentType: string; version: number }>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const existing = resources.get(url);
    if (method === "PUT") {
      if (headers.get("if-none-match") === "*" && existing !== undefined) {
        return new Response(null, { status: 412 });
      }
      const ifMatch = headers.get("if-match");
      if (ifMatch !== null && (existing === undefined || `"v${existing.version}"` !== ifMatch)) {
        return new Response(null, { status: 412 });
      }
      const version = (existing?.version ?? 0) + 1;
      resources.set(url, {
        body: String(init?.body ?? ""),
        contentType: headers.get("content-type") ?? "application/octet-stream",
        version,
      });
      return new Response(null, { status: existing === undefined ? 201 : 204 });
    }
    if (existing === undefined) return new Response("not found", { status: 404 });
    return new Response(existing.body, {
      status: 200,
      headers: { "content-type": existing.contentType, etag: `"v${existing.version}"` },
    });
  };
  return { fetch: fetchImpl, resources };
}

/** A hosted, all-clear revocation list on the stub host. */
export async function hostedStatusList(
  host: StubHost,
  overrides: Partial<ConstructorParameters<typeof StatusListClient>[0]> = {},
): Promise<StatusListClient> {
  const client = new StatusListClient({
    url: LIST_URL,
    issuer: ISSUER,
    key: await issuerKey(),
    fetch: host.fetch,
    ...overrides,
  });
  await client.create({ now: NOW });
  return client;
}

export function identityClaims(): IdentityClaims {
  return {
    kind: "identity-credential",
    name: "Maya Torres",
    birthDate: "1999-03-14",
    address: {
      streetAddress: "2540 Sable Creek Drive",
      addressLocality: "Columbus",
      addressRegion: "OH",
      postalCode: "43219",
    },
  };
}

export function disbursementClaims(
  overrides: Partial<DisbursementReceiptClaims> = {},
): DisbursementReceiptClaims {
  return {
    kind: "disbursement-receipt-credential",
    amountUsd: 2000,
    initiatedAt: "2026-06-07T12:00:00.000Z",
    settledAt: "2026-06-07T12:22:00.000Z",
    cardLast4: "5390",
    fundsOffer: "https://maya.pod.example/lending/offer",
    ...overrides,
  };
}

export function repaymentClaims(
  overrides: Partial<RepaymentHistoryClaims> = {},
): RepaymentHistoryClaims {
  return {
    kind: "repayment-history-credential",
    servicedLoan: "https://maya.pod.example/lending/offer",
    onTimePaymentCount: 1,
    latePaymentCount: 0,
    scheduledPaymentCount: 18,
    periodStart: "2026-06-07",
    periodEnd: "2026-07-13",
    ...overrides,
  };
}

export function anchorClaims(
  overrides: Partial<ZkOperandAnchorClaims> = {},
): ZkOperandAnchorClaims {
  return {
    kind: "zk-operand-anchor",
    field: "urn:example:lend#netMonthlyIncomeUsd",
    operandEnc: "0x07b66a6df9e52198d3d823f29c5030fd9721dafcf31b7a44da67a0f21d3710b0",
    ...overrides,
  };
}

/** Issue the canonical freshness-beat employment credential against `list`. */
export async function issueEmployment(list: StatusListClient, index = 42) {
  return issueCredential({
    kind: "employment-income-credential",
    credentialId: CREDENTIAL_ID,
    issuer: ISSUER,
    subject: SUBJECT,
    claims: demoEmploymentClaims(),
    validity: BACKDATED_VALIDITY,
    status: list.entry(index),
    key: await issuerKey(),
  });
}

/** Issue any credential kind against `list` (generalises {@link issueEmployment}). */
export async function issueCredentialAt(
  list: StatusListClient,
  options: {
    kind: CredentialKind;
    credentialId: string;
    claims: CredentialClaims;
    index: number;
    validity?: { validFrom: Date; validUntil?: Date };
  },
): Promise<IssuedCredential> {
  return issueCredential({
    kind: options.kind,
    credentialId: options.credentialId,
    issuer: ISSUER,
    subject: SUBJECT,
    claims: options.claims,
    validity: options.validity ?? BACKDATED_VALIDITY,
    status: list.entry(options.index),
    key: await issuerKey(),
  });
}

/** Parse a Turtle credential document into a mutable Store. */
export function parseTurtle(body: string): Store & DatasetCore {
  return new Store(new Parser({ format: "text/turtle" }).parse(body));
}
