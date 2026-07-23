/**
 * This lender's OWN issuer identity for signing EVERYTHING it writes into a
 * borrower's pod — the scene-3 Loan Offer / Reg Z Disclosure
 * (`origination.ts`) and the scene-5 Repayment-History VC furnished onward
 * to the bureau (`servicing.ts`). ONE issuer identity, mirroring
 * `disbursement`'s `receipt-issuer.ts`: an operator-configured private JWK +
 * hosted Bitstring status list, lazily built and cached per process.
 * Unconfigured ⇒ throws, which each route layer lowers to 503 (fail closed,
 * never an open signer).
 */
import {
  importKeyPair,
  type KeyPair,
  StatusIndexAllocator,
  StatusListClient,
  StatusListError,
} from "@lending/vc-kit";
import type { FintechLenderConfig } from "./config";
import { requiredConfig } from "./config";

export interface FintechIssuerRuntime {
  readonly issuerWebId: string;
  readonly key: KeyPair;
  readonly statusList: StatusListClient;
  readonly allocator: StatusIndexAllocator;
}

/** Build (never cache here — caching is the caller's process-singleton concern) this lender's issuer runtime. */
export async function fintechIssuerRuntime(
  config: FintechLenderConfig,
  statusHostFetch: typeof fetch,
): Promise<FintechIssuerRuntime> {
  const issuerWebId = config.fintechLenderWebId;
  const statusListUrl = requiredConfig(config.statusListUrl, "LENDING_FINTECH_STATUS_LIST_URL");
  const keyJwk = requiredConfig(config.issuerKeyJwk, "LENDING_FINTECH_ISSUER_KEY_JWK");
  const verificationMethod =
    config.issuerKeyVerificationMethod ?? `${issuerWebId.split("#")[0]}#vc-key`;
  const key = await importKeyPair(verificationMethod, JSON.parse(keyJwk));

  return {
    allocator: new StatusIndexAllocator(),
    issuerWebId,
    key,
    statusList: new StatusListClient({
      fetch: statusHostFetch,
      issuer: issuerWebId,
      key,
      url: statusListUrl,
    }),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Hosted-list lifetime a freshly-created list is signed for (mirrors the sibling apps' own constant). */
export const STATUS_LIST_VALID_DAYS = 400;

function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

/** Create the hosted list on first use. Absent -> all-clear signed list; present -> no-op. */
export async function ensureFintechStatusList(
  runtime: FintechIssuerRuntime,
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
