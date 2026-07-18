/**
 * This rail's OWN issuer identity for signing the Disbursement Receipt VC
 * (design §6.2 row 7). Mirrors `verifications`' per-flow issuer runtime
 * (`lib/server/issuer-rail.ts`): an operator-configured private JWK + hosted
 * Bitstring status list, lazily built and cached per process (constructing a
 * fresh verifier/key per request would be wasteful and — for the status
 * list's create-on-first-use race — actively wrong). Unconfigured ⇒ throws,
 * which the route layer lowers to 503 (fail closed, never an open signer).
 */
import {
  importKeyPair,
  type KeyPair,
  StatusIndexAllocator,
  StatusListClient,
  StatusListError,
} from "@lending/vc-kit";
import type { DisbursementConfig } from "./config";
import { requiredConfig } from "./config";

export interface ReceiptIssuerRuntime {
  readonly issuerWebId: string;
  readonly key: KeyPair;
  readonly statusList: StatusListClient;
  readonly allocator: StatusIndexAllocator;
}

export interface ReceiptIssuerOptions {
  readonly config: DisbursementConfig;
  readonly statusHostFetch: typeof fetch;
  /** Injected in tests: a pre-generated signing key instead of importing the env JWK. */
  readonly key?: KeyPair;
}

/** Build (never cache here — caching is the caller's process-singleton concern) the receipt issuer runtime. */
export async function createReceiptIssuerRuntime(
  options: ReceiptIssuerOptions,
): Promise<ReceiptIssuerRuntime> {
  const { config } = options;
  const issuerWebId = config.disbursementWebId;
  const statusListUrl = requiredConfig(
    config.statusListUrl,
    "LENDING_DISBURSEMENT_STATUS_LIST_URL",
  );

  let key = options.key;
  if (key === undefined) {
    const keyJwk = requiredConfig(config.issuerKeyJwk, "LENDING_DISBURSEMENT_ISSUER_KEY_JWK");
    const verificationMethod =
      config.issuerKeyVerificationMethod ?? `${issuerWebId.split("#")[0]}#vc-key`;
    key = await importKeyPair(verificationMethod, JSON.parse(keyJwk));
  }

  return {
    allocator: new StatusIndexAllocator(),
    issuerWebId,
    key,
    statusList: new StatusListClient({
      fetch: options.statusHostFetch,
      issuer: issuerWebId,
      key,
      url: statusListUrl,
    }),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Hosted-list lifetime a freshly-created list is signed for (mirrors `verifications`' own constant). */
export const STATUS_LIST_VALID_DAYS = 400;

function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

/** Create the hosted list on first use. Absent -> all-clear signed list; present -> no-op. */
export async function ensureStatusList(
  runtime: ReceiptIssuerRuntime,
  statusHostFetch: typeof fetch,
  now: Date,
): Promise<void> {
  const probe = await statusHostFetch(runtime.statusList.url, {
    headers: { accept: "application/vc+ld+json, application/json;q=0.9" },
  });
  if (probe.status === 404) {
    await runtime.statusList.create({ now, validUntil: daysFrom(now, STATUS_LIST_VALID_DAYS) });
    return;
  }
  if (!probe.ok) {
    throw new StatusListError(
      `status list probe GET ${runtime.statusList.url} failed: ${probe.status}`,
    );
  }
}
