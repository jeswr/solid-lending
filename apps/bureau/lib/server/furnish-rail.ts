/**
 * The bureau's FURNISHING intake (sm-qz3j.5; design §6.1/§6.2 scene 5 — the
 * credit-graduation close): POST /api/furnish receives the fintech lender's
 * Repayment-History VC and admits it into the bureau's file ONLY if it FULLY
 * verifies through `@lending/vc-kit`'s real fail-closed gate chain (strict
 * structural read, the `repayment-history-credential` SHACL shape, the
 * validity window, the Bitstring status list, and a REAL `eddsa-rdfc-2022`
 * signature reconstructed and checked over the presented document quads —
 * the "old rail"'s exact same verifier, never a stub), the credential's
 * issuer is on the operator-configured trusted-furnisher allowlist, AND the
 * credential is bound to the AUTHENTICATED caller presenting it
 * (`credentialSubject == caller.webid` — L3, this route's own obligation per
 * @jeswr/solid-pod-guard's SKILL.md: a fully valid credential about someone
 * ELSE must never be admitted for this caller). An untrusted issuer, a
 * tampered signature, an expired/revoked credential, or a subject mismatch
 * is refused (403) — nothing is ever recorded on a failed verification.
 *
 * GET /api/furnished reads back the AUTHENTICATED caller's OWN furnished
 * tradeline records (never another borrower's) — see ./furnished-store.ts
 * for the known demo-scope limit (an in-memory ledger, not a pod resource).
 *
 * Identity is never accepted from request input: @jeswr/solid-pod-guard's
 * `createPodRouteGuard` DPoP-verifies the caller (L1) and derives the pod
 * from the token WebID's bidirectional `pim:storage` binding (L2) — this
 * rail requires a REAL, bound borrower pod on every request even though it
 * never performs pod IO itself (the binding is what proves "this really is
 * a borrower", not a resource this route reads or writes).
 *
 * An empty trusted-furnisher allowlist fails the whole rail closed (503) —
 * "verify against no one" is never a pass.
 */
import {
  createPodRouteGuard,
  type OwnerBindingSeams,
  type PodGuardConfig,
  type PodRouteGuard,
} from "@jeswr/solid-pod-guard";
import { type PaymentHistory, RepaymentHistoryCredential } from "@lending/data-model";
import { type VerifyCredentialOptions, verifyCredential } from "@lending/vc-kit";
import { DataFactory, Parser, Store } from "n3";
import { notConfigured } from "./config";
import { createFurnishedStore, type FurnishedRecord, type FurnishedStore } from "./furnished-store";
import { publicRequestUrl as defaultPublicRequestUrl } from "./url";

/** Verification seams `verifyCredential` consumes — injected in tests with in-process issuer fixtures. */
export type VerifySeams = Pick<
  VerifyCredentialOptions,
  "resolveKey" | "isControlledBy" | "webIdFetch" | "statusFetch" | "trustedStatusIssuers"
>;

export interface FurnishServiceOptions {
  readonly guardConfig: PodGuardConfig;
  /** Issuers trusted to sign a furnished Repayment-History VC (the fintech lender's WebID, plus any future lender's). */
  readonly trustedFurnishers: readonly string[];
  /** Injected in tests: key/status resolution seams. Default (prod): the real WebID-document resolver, unless `guardConfig.allowInsecureLoopback` (dev/e2e). */
  readonly seams?: VerifySeams;
  readonly ownerSeams?: OwnerBindingSeams;
  readonly publicRequestUrl?: (request: Request) => string;
  /** Injected in tests: a fresh, isolated ledger. Defaults to a private in-memory store. */
  readonly store?: FurnishedStore;
  readonly now?: () => Date;
}

export interface FurnishService {
  /** POST `{ credential }` — scene 5: verify + record a furnished Repayment-History VC. */
  furnish(request: Request): Promise<Response>;
  /** GET — the caller's own furnished-tradelines view. */
  furnished(request: Request): Promise<Response>;
}

function badRequest(detail: string): Response {
  return Response.json({ detail, error: "malformed_request", simulated: true }, { status: 400 });
}

/** A record's public projection (the same shape POST and GET both return). */
function present(record: FurnishedRecord) {
  return {
    credentialId: record.credentialId,
    furnishedAt: record.furnishedAt,
    issuer: record.issuer,
    latePaymentCount: record.latePaymentCount,
    onTimePaymentCount: record.onTimePaymentCount,
    scheduledPaymentCount: record.scheduledPaymentCount,
    servicedLoan: record.servicedLoan,
  };
}

export function createFurnishService(options: FurnishServiceOptions): FurnishService {
  const store = options.store ?? createFurnishedStore();

  function seams(): VerifySeams {
    if (options.seams !== undefined) return options.seams;
    // Dev/e2e ONLY (mirrors the sibling `fintech-lender` app's loan-file
    // read): loopback WebID documents and status hosts are not reachable
    // through the real SSRF-guarded default resolver. Production leaves this
    // empty — the REAL WebID-document key resolver runs.
    return options.guardConfig.allowInsecureLoopback
      ? { statusFetch: fetch.bind(globalThis), webIdFetch: fetch.bind(globalThis) }
      : {};
  }

  const guard: PodRouteGuard = createPodRouteGuard({
    config: options.guardConfig,
    ...(options.ownerSeams !== undefined ? { ownerSeams: options.ownerSeams } : {}),
    publicRequestUrl: options.publicRequestUrl ?? defaultPublicRequestUrl,
  });

  return {
    async furnish(request) {
      return guard.handle(request, async (caller, body) => {
        if (options.trustedFurnishers.length === 0) {
          return notConfigured("LENDING_BUREAU_TRUSTED_FURNISHERS is unset");
        }

        const credential = body.credential;
        if (typeof credential !== "string" || credential.trim().length === 0) {
          return badRequest("body.credential must be a non-empty Turtle document string");
        }

        const now = options.now?.() ?? new Date();
        const outcome = await verifyCredential(credential, {
          expectShape: "repayment-history-credential",
          now,
          trustedIssuers: options.trustedFurnishers,
          ...seams(),
        });

        const subjectBound =
          outcome.credential?.subject !== undefined && outcome.credential.subject === caller.webid;
        if (!outcome.verified || !subjectBound || outcome.credential === undefined) {
          return Response.json(
            {
              checks: { subjectBound, verified: outcome.verified },
              error: "verification_failed",
              errors: [
                ...outcome.errors.map((entry) => entry.code),
                ...(subjectBound ? [] : ["SUBJECT_MISMATCH"]),
              ],
              simulated: true,
            },
            { status: 403 },
          );
        }

        const credentialInfo = outcome.credential;
        if (store.has(caller.webid, credentialInfo.id)) {
          return Response.json(
            {
              detail: "this tradeline was already furnished",
              error: "already_furnished",
              simulated: true,
            },
            { status: 409 },
          );
        }

        // The shape gate above already confirmed conformance; read the
        // domain fields through the SAME typed wrapper the rest of the
        // workspace uses (house RDF discipline — never hand-walk the graph).
        let dataset: Store;
        try {
          dataset = new Store(new Parser({ format: "text/turtle" }).parse(credential));
        } catch (error) {
          return Response.json(
            { detail: (error as Error).message, error: "internal_error", simulated: true },
            { status: 500 },
          );
        }
        let history: PaymentHistory;
        try {
          const wrapper = new RepaymentHistoryCredential(
            DataFactory.namedNode(credentialInfo.id),
            dataset,
            DataFactory,
          );
          history = wrapper.credentialSubject.paymentHistory;
        } catch (error) {
          return Response.json(
            { detail: (error as Error).message, error: "internal_error", simulated: true },
            { status: 500 },
          );
        }

        const record: FurnishedRecord = {
          credentialId: credentialInfo.id,
          furnishedAt: now.toISOString(),
          issuer: credentialInfo.issuer,
          latePaymentCount: history.latePaymentCount,
          onTimePaymentCount: history.onTimePaymentCount,
          scheduledPaymentCount: history.scheduledPaymentCount,
          servicedLoan: history.servicedLoanIri,
          subject: caller.webid,
        };
        store.add(record);

        return Response.json({ furnished: present(record), simulated: true });
      });
    },

    async furnished(request) {
      return guard.handle(request, async (caller) => {
        return Response.json({
          simulated: true,
          tradelines: store.list(caller.webid).map(present),
        });
      });
    },
  };
}
