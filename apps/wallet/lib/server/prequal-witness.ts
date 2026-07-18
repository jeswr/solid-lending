/**
 * Read + VERIFY-ON-VIEW the three scene-2 ZK-provable credentials and their
 * operand anchors, then project the (hidden) witness values pre-qualification
 * proving needs. Every value is read ONLY after the full fail-closed
 * `verifyCredential` gate chain (signature, issuer key binding, validity
 * window, revocation status, SHACL shape) — an unverified value never
 * becomes a witness.
 *
 * NODE-ONLY today (see this app's README "known demo-scope limitations"):
 * `@lending/vc-kit` re-exports `@jeswr/solid-vc`, whose published bundle
 * statically imports `node:crypto`/`node:zlib` — it cannot be pulled into a
 * browser bundle without a build failure, so THIS scaffold's pre-qual rail
 * runs the real prove/verify round trip in a Route Handler (Node runtime),
 * browser-TRIGGERED, exactly mirroring `lib/server/dev-seed.ts`'s already-
 * documented "no in-browser WASM runtime yet" honesty note. The witness
 * values never leave this process except as ZK proofs (never in the clear).
 */
import { type fetchRdf, parseRdf } from "@jeswr/fetch-rdf";
import {
  BankCashFlowCredential,
  CashFlowScoreCredential,
  EmploymentIncomeCredential,
  type LendingResourceKind,
  ZkOperandAnchor,
} from "@lending/data-model";
import { ANCHOR_POD_PATHS, CREDENTIAL_POD_PATHS, ISSUER_ROLES } from "@lending/seeds";
import { verifyCredential } from "@lending/vc-kit";
import { DataFactory } from "n3";

export class PreQualWitnessError extends Error {}

interface OneLeg {
  readonly value: number;
  readonly operandEnc: string;
  /** The anchor VC's own Turtle body — forwarded to the verifier as-is. */
  readonly anchorTurtle: string;
}

export interface PreQualWitnessBundle {
  readonly netMonthlyIncomeUsd: OneLeg;
  readonly cashFlowScoreValue: OneLeg;
  readonly nsf90Count: OneLeg;
}

function podPath(podBase: string, rootRelativePath: string): string {
  return `${podBase}${rootRelativePath.slice(1)}`;
}

/**
 * GET + the full fail-closed verify chain; returns the RAW Turtle body once
 * verified. `verifyCredential` is called with the raw STRING body (never a
 * pre-parsed dataset) — matching the seeder's own proven-working call shape
 * (`seeds/test/pod-integration.test.ts`); a dataset built by a different RDF
 * parser (`@jeswr/fetch-rdf`'s) does not round-trip identically through
 * solid-vc's internal proof/status machinery.
 */
async function verifiedTurtle(
  iri: string,
  expectShape: LendingResourceKind,
  trustedIssuer: string,
  now: Date,
  fetchImpl: typeof fetch,
): Promise<{ turtle: string; dataset: Awaited<ReturnType<typeof fetchRdf>>["dataset"] }> {
  const response = await fetchImpl(iri).catch((error: unknown) => {
    throw new PreQualWitnessError(`could not read ${iri}: ${(error as Error).message}`);
  });
  if (!response.ok) {
    throw new PreQualWitnessError(`could not read ${iri}: HTTP ${response.status}`);
  }
  const turtle = await response.text();
  const outcome = await verifyCredential(turtle, {
    expectShape,
    now,
    trustedIssuers: [trustedIssuer],
    webIdFetch: fetchImpl,
    statusFetch: fetchImpl,
  });
  if (!outcome.verified) {
    const detail = outcome.errors.map((error) => `${error.code}: ${error.message}`).join("; ");
    throw new PreQualWitnessError(`${iri} did not verify: ${detail}`);
  }
  const dataset = await parseRdf(turtle, "text/turtle", { baseIRI: iri });
  return { turtle, dataset };
}

/** One (credential, anchor) leg: verify both, project the hidden value + its
 * issuer-anchored encoding. */
async function readLeg<Subject>(options: {
  readonly podBase: string;
  readonly now: Date;
  readonly fetchImpl: typeof fetch;
  readonly credentialPath: string;
  readonly credentialKind: LendingResourceKind;
  readonly issuerRole: keyof typeof ISSUER_ROLES;
  readonly anchorPath: string;
  wrap(
    iri: string,
    dataset: Awaited<ReturnType<typeof fetchRdf>>["dataset"],
  ): { credentialSubject: Subject };
  read(subject: Subject): number;
}): Promise<OneLeg> {
  const issuer = podPath(options.podBase, ISSUER_ROLES[options.issuerRole].docPath);
  const credentialIri = podPath(options.podBase, options.credentialPath);
  const anchorIri = podPath(options.podBase, options.anchorPath);
  const [credential, anchor] = await Promise.all([
    verifiedTurtle(credentialIri, options.credentialKind, issuer, options.now, options.fetchImpl),
    verifiedTurtle(anchorIri, "zk-operand-anchor", issuer, options.now, options.fetchImpl),
  ]);
  const value = options.read(options.wrap(credentialIri, credential.dataset).credentialSubject);
  const anchorResource = new ZkOperandAnchor(
    DataFactory.namedNode(anchorIri),
    anchor.dataset,
    DataFactory,
  );
  return {
    value,
    operandEnc: anchorResource.credentialSubject.operandEnc,
    anchorTurtle: anchor.turtle,
  };
}

/** Read + verify all three legs the scene-2 conjunction proves over. */
export async function readPreQualWitnesses(options: {
  readonly podBase: string;
  readonly now: Date;
  readonly fetchImpl?: typeof fetch;
}): Promise<PreQualWitnessBundle> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { podBase, now } = options;

  const [netMonthlyIncomeUsd, cashFlowScoreValue, nsf90Count] = await Promise.all([
    readLeg({
      podBase,
      now,
      fetchImpl,
      credentialPath: CREDENTIAL_POD_PATHS.income,
      credentialKind: "employment-income-credential",
      issuerRole: "incomeVerifier",
      anchorPath: ANCHOR_POD_PATHS.income,
      wrap: (iri, dataset) =>
        new EmploymentIncomeCredential(DataFactory.namedNode(iri), dataset, DataFactory),
      read: (subject) => subject.netMonthlyIncomeUsd,
    }),
    readLeg({
      podBase,
      now,
      fetchImpl,
      credentialPath: CREDENTIAL_POD_PATHS.cashFlowScore,
      credentialKind: "cashflow-score-credential",
      issuerRole: "cashFlowScorer",
      anchorPath: ANCHOR_POD_PATHS.score,
      wrap: (iri, dataset) =>
        new CashFlowScoreCredential(DataFactory.namedNode(iri), dataset, DataFactory),
      read: (subject) => subject.cashFlowScoreValue,
    }),
    readLeg({
      podBase,
      now,
      fetchImpl,
      credentialPath: CREDENTIAL_POD_PATHS.bankCashFlow,
      credentialKind: "bank-cashflow-credential",
      issuerRole: "bankDataProvider",
      anchorPath: ANCHOR_POD_PATHS.nsf90,
      wrap: (iri, dataset) =>
        new BankCashFlowCredential(DataFactory.namedNode(iri), dataset, DataFactory),
      read: (subject) => subject.nsf90Count,
    }),
  ]);

  return { netMonthlyIncomeUsd, cashFlowScoreValue, nsf90Count };
}
