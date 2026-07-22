/**
 * The authenticated pod-route boundary for scene 4 "funded in minutes"
 * (SECURITY-CRITICAL). Every handler:
 *
 *   1. requires a DPoP-bound Solid-OIDC caller — `@jeswr/solid-pod-guard`'s
 *      `createPodRouteGuard` (anonymous ⇒ 401 + `WWW-Authenticate`; caller-
 *      supplied `pod`/`webid` ⇒ 400; unconfigured issuer allowlist ⇒ 503) —
 *      NO simulated bypass exists in server code, in any runtime mode;
 *   2. derives `{webid, podBase}` from the TOKEN (the borrower's OWN
 *      authenticated session), never from request parameters;
 *   3. reads + verifies the borrower's GRANTED loan offer over THIS APP's
 *      OWN service-identity pod fetch (`createServicePodFetch`,
 *      client_credentials + DPoP) — the real WAC grant boundary the pod
 *      itself enforces against that identity. There is NO anonymous
 *      fallback: an unconfigured service identity fails closed (503), and a
 *      non-granted or revoked service identity is denied by the pod
 *      (401/403), never silently treated as "no offer";
 *   4. refuses the payout outright — NO receipt written — for every offer
 *      problem: missing, malformed, unverified, unbound, or expired
 *      (`funding-instruction.ts`);
 *   5. on a verified offer, runs the deterministic simulated payout and
 *      signs + create-once-writes the Disbursement Receipt VC into the pod —
 *      a repeat call against an already-funded loan is refused (409), never a
 *      second payout. A pre-flight read IS required: the wallet's grant
 *      engine (`ensureResourcePlaceholder`) idempotently PUTs an EMPTY
 *      placeholder at the receipt path the moment it is write-granted (WAC
 *      evaluates a resource CREATE against the parent container, so a
 *      not-yet-existing resource's own Write grant is otherwise inert) —
 *      `pod-io.ts`'s `createPodTurtle` reads first to tell that placeholder
 *      apart from a GENUINE prior receipt (409, no write attempted) before
 *      safely replacing it (`If-Match` on its own current ETag).
 *
 * Fail-closed invariants (do NOT weaken): unconfigured OIDC-issuer allowlist
 * ⇒ 503; unconfigured service identity ⇒ 503; unconfigured issuer signing
 * key/status list ⇒ 503; unconfigured offer-issuer trust list ⇒ 503; any
 * binding/grant/verification failure ⇒ refusal, never a pass; unexpected
 * errors ⇒ 500, never approve.
 */
import {
  createPodRouteGuard,
  createServicePodFetch,
  type OwnerBindingSeams,
  PodAccessError,
  type PodRouteGuard,
} from "@jeswr/solid-pod-guard";
import { RESOURCE_POD_PATHS } from "@lending/data-model";
import {
  ClaimInputError,
  type IssuedCredential,
  issueCredential,
  IssueRefusedError,
  type KeyPair,
  StatusListError,
} from "@lending/vc-kit";
import type { DisbursementConfig } from "./config";
import { notConfigured, requiredConfig } from "./config";
import {
  readVerifiedFundingInstruction,
  type VerifySeams as OfferVerifySeams,
} from "./funding-instruction";
import { createPodTurtle } from "./pod-io";
import { MAX_SETTLEMENT_MINUTES, runSimulatedPayout } from "./payout";
import {
  createReceiptIssuerRuntime,
  ensureStatusList,
  type ReceiptIssuerRuntime,
} from "./receipt-issuer";
import { publicRequestUrl as defaultPublicRequestUrl } from "./url";

export interface PayoutRailServiceOptions {
  readonly config: DisbursementConfig;
  readonly guard?: PodRouteGuard;
  /** Injected in tests together with {@link serviceWebId} (an account authFetch). */
  readonly podFetch?: typeof fetch;
  readonly serviceWebId?: string;
  /** Injected in tests: hosts this rail's own signed status list. Defaults to `podFetch`. */
  readonly statusHostFetch?: typeof fetch;
  /** Injected in tests: a pre-generated receipt-signing key instead of the env JWK. */
  readonly issuerKey?: KeyPair;
  readonly now?: () => Date;
  readonly offerSeams?: OfferVerifySeams;
  /**
   * Owner-binding seams (the L2 forward-claim profile fetch) — injected in
   * tests. See the sibling apps' identical seam for why a real-HTTPS-listener
   * test fixture needs it skipped.
   */
  readonly ownerSeams?: OwnerBindingSeams;
  /** Public-URL reconstruction for the DPoP `htu` binding. Defaults to this app's basePath. */
  readonly publicRequestUrl?: (request: Request) => string;
}

export interface PayoutReport {
  readonly simulated: true;
  readonly receiptIri: string;
  readonly fundsOfferIri: string;
  readonly amountUsd: number;
  readonly initiatedAt: string;
  readonly settledAt: string;
  readonly settlementMinutes: number;
  readonly maxSettlementMinutes: number;
  readonly cardLast4: string;
}

export interface PayoutRailService {
  payout(request: Request): Promise<Response>;
}

function errorResponse(error: unknown): Response {
  if (error instanceof PodAccessError) {
    return Response.json(
      { detail: error.message, error: "pod_access", simulated: true },
      { status: error.status },
    );
  }
  if (error instanceof StatusListError) {
    return Response.json(
      { detail: error.message, error: "status_list", simulated: true },
      { status: 502 },
    );
  }
  if (error instanceof Error && error.message.endsWith("is unset")) {
    return notConfigured(error.message);
  }
  if (error instanceof IssueRefusedError || error instanceof ClaimInputError) {
    // A shape-violating claim graph is a SERVER defect, never a payload the
    // caller controlled — never echo graph internals.
    return Response.json({ error: "issuance_defect", simulated: true }, { status: 500 });
  }
  return Response.json({ error: "internal_error", simulated: true }, { status: 500 });
}

export function createPayoutRailService(options: PayoutRailServiceOptions): PayoutRailService {
  const { config } = options;
  const now = options.now ?? (() => new Date());
  const guard =
    options.guard ??
    createPodRouteGuard({
      config,
      publicRequestUrl: options.publicRequestUrl ?? defaultPublicRequestUrl,
      ...(options.ownerSeams !== undefined ? { ownerSeams: options.ownerSeams } : {}),
    });

  // Built lazily and cached: the service fetch owns a token cache + DPoP key,
  // and an unconfigured deployment must answer 503 (fail closed), not throw
  // at module load. NO anonymous fallback exists (see the module header).
  let podFetch: typeof fetch | undefined;
  function getPodFetch(): typeof fetch | Response {
    if (podFetch !== undefined) return podFetch;
    if (options.podFetch !== undefined) {
      podFetch = options.podFetch;
      return podFetch;
    }
    try {
      podFetch = createServicePodFetch({
        allowInsecureLoopback: config.allowInsecureLoopback,
        clientId: requiredConfig(
          config.podServiceClientId,
          "LENDING_DISBURSEMENT_POD_SERVICE_CLIENT_ID",
        ),
        clientSecret: requiredConfig(
          config.podServiceClientSecret,
          "LENDING_DISBURSEMENT_POD_SERVICE_CLIENT_SECRET",
        ),
        issuer: requiredConfig(config.podServiceIssuer, "LENDING_DISBURSEMENT_POD_SERVICE_ISSUER"),
      });
      return podFetch;
    } catch (error) {
      return errorResponse(error);
    }
  }

  let receiptRuntime: Promise<ReceiptIssuerRuntime> | undefined;
  function getReceiptRuntime(statusHostFetch: typeof fetch): Promise<ReceiptIssuerRuntime> {
    receiptRuntime ??= createReceiptIssuerRuntime({
      config,
      statusHostFetch,
      ...(options.issuerKey !== undefined ? { key: options.issuerKey } : {}),
    });
    return receiptRuntime;
  }

  return {
    async payout(request) {
      return guard.handle(request, async (caller) => {
        const fetchOrResponse = getPodFetch();
        if (fetchOrResponse instanceof Response) return fetchOrResponse;
        const podFetchInstance = fetchOrResponse;
        const statusHostFetch = options.statusHostFetch ?? podFetchInstance;

        try {
          const evaluatedAt = now();
          const receiptIri = `${caller.podBase}${RESOURCE_POD_PATHS["disbursement-receipt-credential"].slice(1)}`;

          const instruction = await readVerifiedFundingInstruction(
            caller.podBase,
            caller.webid,
            config,
            {
              now: evaluatedAt,
              podFetch: podFetchInstance,
              ...(options.offerSeams !== undefined ? { seams: options.offerSeams } : {}),
            },
          );

          const payout = runSimulatedPayout(evaluatedAt);

          const runtime = await getReceiptRuntime(statusHostFetch);
          await ensureStatusList(runtime, statusHostFetch, evaluatedAt);
          const index = runtime.allocator.allocate(receiptIri);

          const issued: IssuedCredential = await issueCredential({
            claims: {
              amountUsd: instruction.principalUsd,
              cardLast4: payout.cardLast4,
              fundsOffer: instruction.offerIri,
              initiatedAt: payout.initiatedAt.toISOString(),
              kind: "disbursement-receipt-credential",
              settledAt: payout.settledAt.toISOString(),
            },
            credentialId: receiptIri,
            issuer: runtime.issuerWebId,
            key: runtime.key,
            kind: "disbursement-receipt-credential",
            status: runtime.statusList.entry(index),
            subject: caller.webid,
            validity: { validFrom: payout.initiatedAt },
          });

          try {
            await createPodTurtle(receiptIri, issued.body, podFetchInstance);
          } catch (writeError) {
            if (writeError instanceof PodAccessError && writeError.status === 409) {
              return Response.json(
                {
                  detail: "this loan already has a disbursement receipt — payout refused",
                  error: "already_funded",
                  receiptIri,
                  simulated: true,
                },
                { status: 409 },
              );
            }
            throw writeError;
          }

          const settlementMinutes = Math.round(
            (payout.settledAt.getTime() - payout.initiatedAt.getTime()) / 60_000,
          );

          return Response.json({
            amountUsd: instruction.principalUsd,
            cardLast4: payout.cardLast4,
            fundsOfferIri: instruction.offerIri,
            initiatedAt: payout.initiatedAt.toISOString(),
            maxSettlementMinutes: MAX_SETTLEMENT_MINUTES,
            receiptIri,
            settledAt: payout.settledAt.toISOString(),
            settlementMinutes,
            simulated: true,
          } satisfies PayoutReport);
        } catch (error) {
          return errorResponse(error);
        }
      });
    },
  };
}
