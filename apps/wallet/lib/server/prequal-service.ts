/**
 * Scene 2 "shop without stripping": the borrower's pre-qualification proof
 * over `income >= $2,200/mo ∧ cash-flow score >= 660 ∧ NSF₉₀ = 0` (design §5),
 * genuinely proved with `@lending/vc-kit`'s sparq UltraHonk prover and
 * immediately checked with its real fail-closed verifier.
 *
 * KNOWN DEMO-SCOPE LIMITATION (disclosed, not hidden — see this app's
 * README): there is no live lender rail in this repo yet to VP-POST to
 * (`bank-lender`/`fintech-lender` are still scaffolds), so this module
 * stands in as BOTH challenger and verifier — a self-check the demo narrates
 * honestly rather than a real lender's own `/api/prequal/verify`. The
 * PROOF ITSELF, the anchor binding, and the verifier's nine fail-closed
 * gates are never mocked — nothing here is more lenient than a real lender
 * rail would be. `@lending/vc-kit` cannot be bundled into a browser build
 * (see `./prequal-witness.ts`'s header) — this rail is browser-TRIGGERED,
 * proving/verifying server-side, mirroring `./dev-seed.ts`.
 */
import {
  type PreQualificationProof,
  type PreQualificationVerifyResult,
  provePreQualification,
  verifyPreQualification,
  ZkError,
} from "@lending/vc-kit";
import { ISSUER_ROLES } from "@lending/seeds";
import { mintChallenge, nonceConsumer } from "./prequal-nonces";
import { readPreQualWitnesses } from "./prequal-witness";

export class PreQualServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface PreQualChallenge {
  readonly sessionKey: string;
  readonly nonce: string;
}

export function issueChallenge(now: () => Date = () => new Date()): PreQualChallenge {
  return mintChallenge(now);
}

export interface ProveAndVerifyOptions {
  readonly podBase: string;
  readonly webid: string;
  readonly sessionKey: string;
  readonly nonce: string;
  readonly now: Date;
  readonly fetchImpl?: typeof fetch;
}

export interface ProveAndVerifyResult {
  readonly proof: PreQualificationProof;
  readonly verification: PreQualificationVerifyResult;
  readonly proveMs: Readonly<Record<string, number>>;
}

function podPath(podBase: string, rootRelativePath: string): string {
  return `${podBase}${rootRelativePath.slice(1)}`;
}

/**
 * Prove, then immediately verify, the full pre-qualification conjunction —
 * a below-threshold witness makes `provePreQualification` itself throw
 * (`UNSATISFIABLE`): the honest "you cannot forge eligibility" outcome, never
 * a false-positive proof.
 */
export async function proveAndVerify(
  options: ProveAndVerifyOptions,
): Promise<ProveAndVerifyResult> {
  const witnesses = await readPreQualWitnesses({
    podBase: options.podBase,
    now: options.now,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });

  let proof: PreQualificationProof;
  try {
    proof = await provePreQualification({
      netMonthlyIncomeUsd: witnesses.netMonthlyIncomeUsd,
      cashFlowScoreValue: witnesses.cashFlowScoreValue,
      nsf90Count: witnesses.nsf90Count,
      nonce: options.nonce,
    });
  } catch (error) {
    if (error instanceof ZkError) {
      throw new PreQualServiceError(`pre-qualification proof failed: ${error.message}`, 422);
    }
    throw error;
  }

  const trustedIssuers = [
    podPath(options.podBase, ISSUER_ROLES.incomeVerifier.docPath),
    podPath(options.podBase, ISSUER_ROLES.bankDataProvider.docPath),
    podPath(options.podBase, ISSUER_ROLES.cashFlowScorer.docPath),
  ];
  // webIdFetch/statusFetch MUST be explicit: solid-vc's default is an
  // SSRF-guarded fetch that refuses loopback http outright (no config knob
  // reaches it from here) — this dev pod is plain loopback http by design.
  const fetchImpl = options.fetchImpl ?? fetch;
  const verification = await verifyPreQualification(proof, {
    anchors: {
      netMonthlyIncomeUsd: witnesses.netMonthlyIncomeUsd.anchorTurtle,
      cashFlowScoreValue: witnesses.cashFlowScoreValue.anchorTurtle,
      nsf90Count: witnesses.nsf90Count.anchorTurtle,
    },
    webid: options.webid,
    nonce: options.nonce,
    nonces: nonceConsumer,
    sessionKey: options.sessionKey,
    now: options.now,
    trustedIssuers,
    webIdFetch: fetchImpl,
    statusFetch: fetchImpl,
  });

  return {
    proof,
    verification,
    proveMs: {
      netMonthlyIncomeUsd: proof.netMonthlyIncomeUsd.proveMs,
      cashFlowScoreValue: proof.cashFlowScoreValue.proveMs,
      nsf90Count: proof.nsf90Count.proveMs,
    },
  };
}
