/**
 * Scene-2 ZK pre-qualification verifier (SECURITY-CRITICAL; decisions 0005 +
 * 0012, carried over from the mortgage showcase). Implements the VP-POST
 * rail:
 *
 *   1. `challenge` — the DPoP-authenticated presenter mints ONE single-use
 *      nonce, SHARED across all three legs of the conjunction (at most one
 *      live challenge per WebID; minting again replaces it);
 *   2. `demoProof` — produces a REAL Tier-A proof bundle over Maya's pinned
 *      persona witness values, bound to that nonce, plus REAL signed
 *      operand-anchor VCs from the self-hosted demo issuer
 *      (`lib/server/demo-issuer.ts`). Marked `simulated: true` — see that
 *      module's header for the honesty framing. NOTHING here is a placeholder
 *      value or a faked signature: this is the exact machinery
 *      `provePreQualification`/`issueCredential` run in production.
 *   3. `verify` — the presenter POSTs the bundle. `verifyPreQualification`
 *      runs the full fail-closed gate chain (structural, nonce, challenge,
 *      statement, anchor signature/shape/window/status, holder binding,
 *      anchor-operand equality, UltraHonk proof) for all three legs sharing
 *      ONE nonce burn — bound to THIS BANK's own nonce, exactly as a
 *      competing lender's independent pre-qual verification would be (design
 *      §6: "Maya proves ... via ZK to two competing lenders").
 *
 * Fail-closed invariants (do NOT weaken):
 *   - unconfigured issuer allowlists ⇒ 503, never "verify without a check";
 *   - any verification failure ⇒ 403 with the per-leg gate results; the
 *     challenge is already burned (a failed attempt cannot retry the nonce);
 *   - malformed payloads ⇒ 400 BEFORE any cryptographic work;
 *   - unexpected internal errors ⇒ 500, never a pass;
 *   - NO credit pull, NO PII stored: the handler never persists anything.
 */
import {
  apiAuthErrorToResponse,
  ApiAuthError,
  DpopApiVerifier,
  type RateLimiter,
  TokenBucketRateLimiter,
  verifyNextRequest,
} from "@jeswr/solid-api-auth/next";
import {
  createWebIdKeyResolver,
  PREQUALIFICATION_STATEMENTS,
  type PreQualificationField,
  type PreQualificationProof,
  provePreQualification,
  tierAProofFromJson,
  tierAProofToJson,
  ZkError,
  verifyPreQualification,
} from "@lending/vc-kit";
import { ZK_PREQUAL_THRESHOLDS } from "@lending/data-model";
import type { BankLenderConfig } from "./config";
import { notConfigured } from "./config";
import { demoIssuer, demoWitnessValues } from "./demo-issuer";
import { createNonceStore, type NonceStore } from "./nonce-store";

const PREQUAL_FIELDS: readonly PreQualificationField[] = [
  "netMonthlyIncomeUsd",
  "cashFlowScoreValue",
  "nsf90Count",
];

const MAX_VERIFY_BODY_BYTES = 1_048_576;
const MAX_ANCHOR_VC_BYTES = 131_072;

export interface PrequalServiceOptions {
  readonly config: BankLenderConfig;
  readonly verifier?: DpopApiVerifier;
  readonly nonces?: NonceStore;
  readonly now?: () => Date;
  readonly rateLimiter?: RateLimiter;
}

export interface PrequalService {
  challenge(request: Request): Promise<Response>;
  demoProof(request: Request): Promise<Response>;
  verify(request: Request): Promise<Response>;
}

class BadRequestError extends Error {}

function sessionKeyOf(webid: string): string {
  return `prequal ${webid}`;
}

export function createPrequalService(options: PrequalServiceOptions): PrequalService {
  const { config } = options;
  const now = options.now ?? (() => new Date());
  const nonces = options.nonces ?? createNonceStore();
  const rateLimiter =
    options.rateLimiter ?? new TokenBucketRateLimiter({ capacity: 30, refillPerSec: 0.5 });

  let verifier: DpopApiVerifier | undefined = options.verifier;
  const getVerifier = (): DpopApiVerifier => {
    verifier ??= new DpopApiVerifier({
      allowInsecureLoopback: config.allowInsecureLoopback,
      trustedIssuers: config.trustedOidcIssuers,
      trustForwardedHeaders: config.trustForwardedHeaders,
    });
    return verifier;
  };

  async function authenticate(request: Request): Promise<{ webId: string } | Response> {
    if (config.trustedOidcIssuers.length === 0) {
      return notConfigured("LENDING_TRUSTED_OIDC_ISSUERS is unset");
    }
    try {
      const credentials = await verifyNextRequest(request, {
        rateLimiter,
        requireOwner: false,
        verifier: getVerifier(),
      });
      return { webId: credentials.webId };
    } catch (error) {
      if (error instanceof ApiAuthError) return apiAuthErrorToResponse(error);
      return Response.json({ error: "internal_error", simulated: true }, { status: 500 });
    }
  }

  /** The composite key/status resolution: the self-hosted demo issuer, falling back to the real WebID rail for a live `verifications` deployment. */
  async function anchorSeams(): Promise<{
    resolveKey: (verificationMethod: string) => Promise<CryptoKey | undefined>;
    isControlledBy: (verificationMethod: string, issuer: string) => boolean | Promise<boolean>;
    statusFetch: typeof fetch;
    trustedIssuers: readonly string[];
  }> {
    const issuer = await demoIssuer();
    const fallback = createWebIdKeyResolver();
    return {
      isControlledBy: (verificationMethod, credentialIssuer) => {
        if (credentialIssuer === issuer.webId) {
          return verificationMethod === issuer.key.verificationMethod;
        }
        return fallback.isControlledBy(verificationMethod, credentialIssuer);
      },
      resolveKey: async (verificationMethod) => {
        if (verificationMethod === issuer.key.verificationMethod) return issuer.key.publicKey;
        return fallback.resolveKey(verificationMethod);
      },
      statusFetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin === new URL(issuer.webId).origin) return issuer.statusFetch(input, init);
        return fetch(input, init);
      },
      trustedIssuers: [issuer.webId, ...config.trustedAnchorIssuers],
    };
  }

  return {
    async challenge(request: Request): Promise<Response> {
      const identity = await authenticate(request);
      if (identity instanceof Response) return identity;
      const nonce = nonces.mint(sessionKeyOf(identity.webId));
      return Response.json({
        nonce,
        simulated: true,
        statements: PREQUALIFICATION_STATEMENTS,
        thresholds: ZK_PREQUAL_THRESHOLDS,
      });
    },

    /**
     * Demo-only convenience: produce a REAL proof bundle + REAL signed
     * anchors over Maya's pinned witness, bound to the caller-supplied LIVE
     * nonce. See the module header — this stands in for the wallet's own
     * pod-read + in-browser proving UX, which is out of this app's slice.
     */
    async demoProof(request: Request): Promise<Response> {
      const identity = await authenticate(request);
      if (identity instanceof Response) return identity;
      let nonce: string;
      try {
        const raw = await request.text();
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (typeof parsed.nonce !== "string" || parsed.nonce.length === 0) {
          throw new BadRequestError("body.nonce must be a non-empty string");
        }
        nonce = parsed.nonce;
      } catch (error) {
        const detail =
          error instanceof BadRequestError ? error.message : "body must be JSON with a nonce";
        return Response.json(
          { detail, error: "malformed_request", simulated: true },
          { status: 400 },
        );
      }

      const issuer = await demoIssuer();
      const values = demoWitnessValues();
      const nowValue = now();
      const [income, score, nsf] = await Promise.all([
        issuer.anchorFor("netMonthlyIncomeUsd", identity.webId, nowValue),
        issuer.anchorFor("cashFlowScoreValue", identity.webId, nowValue),
        issuer.anchorFor("nsf90Count", identity.webId, nowValue),
      ]);

      let proof: PreQualificationProof;
      try {
        proof = await provePreQualification({
          cashFlowScoreValue: { operandEnc: score.operandEnc, value: values.cashFlowScoreValue },
          netMonthlyIncomeUsd: { operandEnc: income.operandEnc, value: values.netMonthlyIncomeUsd },
          nonce,
          nsf90Count: { operandEnc: nsf.operandEnc, value: values.nsf90Count },
        });
      } catch (error) {
        const detail = error instanceof ZkError ? error.message : "proving failed";
        return Response.json({ detail, error: "prove_failed", simulated: true }, { status: 500 });
      }

      return Response.json({
        anchors: {
          cashFlowScoreValue: score.credential.body,
          netMonthlyIncomeUsd: income.credential.body,
          nsf90Count: nsf.credential.body,
        },
        proof: {
          cashFlowScoreValue: tierAProofToJson(proof.cashFlowScoreValue),
          netMonthlyIncomeUsd: tierAProofToJson(proof.netMonthlyIncomeUsd),
          nsf90Count: tierAProofToJson(proof.nsf90Count),
        },
        simulated: true,
      });
    },

    async verify(request: Request): Promise<Response> {
      const identity = await authenticate(request);
      if (identity instanceof Response) return identity;

      let nonce: string;
      let proof: PreQualificationProof;
      let anchors: Record<PreQualificationField, string>;
      try {
        const raw = await request.text();
        if (raw.length > MAX_VERIFY_BODY_BYTES) {
          return Response.json({ error: "payload_too_large", simulated: true }, { status: 413 });
        }
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (typeof parsed.nonce !== "string" || parsed.nonce.length === 0) {
          throw new BadRequestError("body.nonce must be a non-empty string");
        }
        nonce = parsed.nonce;
        const proofBody = parsed.proof;
        const anchorsBody = parsed.anchors;
        if (typeof proofBody !== "object" || proofBody === null) {
          throw new BadRequestError("body.proof must be an object keyed by field");
        }
        if (typeof anchorsBody !== "object" || anchorsBody === null) {
          throw new BadRequestError("body.anchors must be an object keyed by field");
        }
        const parsedProof: Partial<
          Record<PreQualificationField, ReturnType<typeof tierAProofFromJson>>
        > = {};
        const parsedAnchors: Partial<Record<PreQualificationField, string>> = {};
        for (const field of PREQUAL_FIELDS) {
          const entry = (proofBody as Record<string, unknown>)[field];
          if (entry === undefined) throw new BadRequestError(`body.proof.${field} is required`);
          parsedProof[field] = tierAProofFromJson(entry);
          const anchor = (anchorsBody as Record<string, unknown>)[field];
          if (typeof anchor !== "string" || anchor.length === 0) {
            throw new BadRequestError(`body.anchors.${field} must be a Turtle document string`);
          }
          if (anchor.length > MAX_ANCHOR_VC_BYTES) {
            throw new BadRequestError(`body.anchors.${field} exceeds the size bound`);
          }
          parsedAnchors[field] = anchor;
        }
        proof = parsedProof as unknown as PreQualificationProof;
        anchors = parsedAnchors as Record<PreQualificationField, string>;
      } catch (error) {
        const detail =
          error instanceof BadRequestError
            ? error.message
            : error instanceof ZkError
              ? error.message
              : "body is not a valid pre-qualification presentation";
        return Response.json(
          { detail, error: "malformed_request", simulated: true },
          { status: 400 },
        );
      }

      const seams = await anchorSeams();
      const result = await verifyPreQualification(proof, {
        anchors,
        isControlledBy: seams.isControlledBy,
        nonce,
        nonces,
        now: now(),
        resolveKey: seams.resolveKey,
        sessionKey: sessionKeyOf(identity.webId),
        statusFetch: seams.statusFetch,
        trustedIssuers: seams.trustedIssuers,
        webid: identity.webId,
      });

      const legs = Object.fromEntries(
        PREQUAL_FIELDS.map((field) => [
          field,
          {
            checks: result.legs[field].checks,
            errors: result.legs[field].errors.map((e) => ({ code: e.code, message: e.message })),
            verified: result.legs[field].verified,
          },
        ]),
      );

      if (!result.verified) {
        return Response.json({ legs, qualified: false, simulated: true }, { status: 403 });
      }
      return Response.json({ legs, qualified: true, simulated: true });
    },
  };
}
