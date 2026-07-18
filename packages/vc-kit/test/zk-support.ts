/**
 * Shared ZK test rig. Proving is expensive (~2 s per proof plus a one-off
 * WASM cold start in single-threaded Node), so the suite proves each
 * scenario ONCE in a shared cache and reuses the transcript across the
 * negative matrix - negative tests vary the VERIFICATION inputs, which never
 * requires a new proof.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEND, ZK_PREQUAL_THRESHOLDS } from "@lending/data-model";
import {
  type IssuedCredential,
  issueCredential,
  type PreQualificationProof,
  type PreQualificationWitness,
  provePreQualification,
  proveTierA,
  type TierAProof,
  type TierAStatement,
} from "../src/index.ts";
import {
  BACKDATED_VALIDITY,
  hostedStatusList,
  ISSUER,
  issuerKey,
  NOW,
  type StubHost,
  SUBJECT,
  stubHost,
} from "./support.ts";

/**
 * PROVENANCE: genuine sparq term encodings of `"<value>"^^xsd:integer` from
 * `sparq_zk_compose::build::encode_int_literal`, captured by
 * `scripts/capture-fixtures.mjs` into `fixtures/operand-enc.json` (see
 * `fixtures/PROVENANCE.json` for the checkout commit + toolchain). In
 * production the ISSUER computes these at issuance and signs them into the
 * operand-anchor VC; the encoding is deterministic and salt-free, so an
 * ADVERSARY can equally compute one for any value they like - which is the
 * forgeability scenario the verifier's anchor-equality gate exists to stop.
 */
const OPERAND_ENC_FIXTURE = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "operand-enc.json"), "utf8"),
) as { encodings: Record<string, string> };
export const OPERAND_ENC: Readonly<Record<number, string>> = Object.fromEntries(
  Object.entries(OPERAND_ENC_FIXTURE.encodings).map(([value, enc]) => [Number(value), enc]),
);

export function encOf(value: number): string {
  const enc = OPERAND_ENC[value];
  if (enc === undefined) throw new Error(`no captured operand_enc fixture for ${value}`);
  return enc;
}

/** The design §6.2 scene-2 statements the suite exercises. */
export const INCOME_STATEMENT: TierAStatement = {
  field: LEND.netMonthlyIncomeUsd,
  op: "ge",
  bound: ZK_PREQUAL_THRESHOLDS.netMonthlyIncomeUsd,
};
export const SCORE_STATEMENT: TierAStatement = {
  field: LEND.cashFlowScoreValue,
  op: "ge",
  bound: ZK_PREQUAL_THRESHOLDS.cashFlowScoreValue,
};
export const NSF_STATEMENT: TierAStatement = {
  field: LEND.nsf90Count,
  op: "eq",
  bound: ZK_PREQUAL_THRESHOLDS.nsf90Count,
};

/** The genuine persona witness values (design §5 Maya Torres; personas.ts). */
export const MAYA_INCOME = 2860;
export const MAYA_SCORE = 720;
export const MAYA_NSF = 0;

/** Fixed challenge nonces the shared proofs are produced for (see cache note). */
export const NONCE_INCOME = "zk-test-nonce-income-2860";
export const NONCE_SCORE = "zk-test-nonce-score-720";
export const NONCE_NSF = "zk-test-nonce-nsf-0";
export const NONCE_FORGED = "zk-test-nonce-forged-9999";
export const NONCE_PREQUAL = "zk-test-nonce-prequal-maya";

const proofCache = new Map<string, Promise<TierAProof>>();

function cachedProve(key: string, prove: () => Promise<TierAProof>): Promise<TierAProof> {
  let pending = proofCache.get(key);
  if (!pending) {
    pending = prove();
    proofCache.set(key, pending);
  }
  return pending;
}

/** A genuine proof of income 2860 >= 2200 (filter_int_d4), for NONCE_INCOME. */
export function incomeProof(): Promise<TierAProof> {
  return cachedProve("income", () =>
    proveTierA({
      statement: INCOME_STATEMENT,
      value: MAYA_INCOME,
      operandEnc: encOf(MAYA_INCOME),
      nonce: NONCE_INCOME,
    }),
  );
}

/** A genuine proof of cash-flow score 720 >= 660 (filter_int_d3), for NONCE_SCORE. */
export function scoreProof(): Promise<TierAProof> {
  return cachedProve("score", () =>
    proveTierA({
      statement: SCORE_STATEMENT,
      value: MAYA_SCORE,
      operandEnc: encOf(MAYA_SCORE),
      nonce: NONCE_SCORE,
    }),
  );
}

/** A genuine proof of NSF₉₀ = 0 (filter_int_d1 - the 1-digit member), for NONCE_NSF. */
export function nsfProof(): Promise<TierAProof> {
  return cachedProve("nsf", () =>
    proveTierA({
      statement: NSF_STATEMENT,
      value: MAYA_NSF,
      operandEnc: encOf(MAYA_NSF),
      nonce: NONCE_NSF,
    }),
  );
}

/**
 * The FORGERY (this repo's analogue of the mortgage showcase's decision-0012
 * regression test): the adversary's real income is 99 (< 2200), so they
 * compute the salt-free encoding of 9999 themselves and prove `9999 >= 2200`
 * - an HONEST proof of a true statement about a value no issuer ever
 * attested. Every cryptographic step succeeds; only the anchor-equality gate
 * can reject it.
 */
export function forgedIncomeProof(): Promise<TierAProof> {
  return cachedProve("forged", () =>
    proveTierA({
      statement: INCOME_STATEMENT,
      value: 9999,
      operandEnc: encOf(9999),
      nonce: NONCE_FORGED,
    }),
  );
}

/** A genuine full pre-qualification bundle (Maya's real values), for NONCE_PREQUAL. */
export function prequalificationProof(): Promise<PreQualificationProof> {
  return cachedPrequal("prequal", () =>
    provePreQualification({
      netMonthlyIncomeUsd: { value: MAYA_INCOME, operandEnc: encOf(MAYA_INCOME) },
      cashFlowScoreValue: { value: MAYA_SCORE, operandEnc: encOf(MAYA_SCORE) },
      nsf90Count: { value: MAYA_NSF, operandEnc: encOf(MAYA_NSF) },
      nonce: NONCE_PREQUAL,
    }),
  );
}

const prequalCache = new Map<string, Promise<PreQualificationProof>>();
function cachedPrequal(
  key: string,
  prove: () => Promise<PreQualificationProof>,
): Promise<PreQualificationProof> {
  let pending = prequalCache.get(key);
  if (!pending) {
    pending = prove();
    prequalCache.set(key, pending);
  }
  return pending;
}

export function witnessOf(value: number): PreQualificationWitness {
  return { value, operandEnc: encOf(value) };
}

/** One-shot nonce consumer accepting exactly (sessionKey, nonce) - then burned. */
export function oneShotNonce(sessionKey: string, nonce: string) {
  let live = true;
  return {
    consume(gotSession: string, gotNonce: string): boolean {
      if (!live || gotSession !== sessionKey || gotNonce !== nonce) return false;
      live = false;
      return true;
    },
  };
}

export interface AnchorRig {
  readonly host: StubHost;
  readonly issue: (overrides?: {
    field?: string;
    operandEnc?: string;
    subject?: string;
    index?: number;
    validity?: { validFrom: Date; validUntil?: Date };
  }) => Promise<IssuedCredential>;
  readonly revoke: (index: number) => Promise<void>;
}

/**
 * An anchor-issuing rig: a stub-hosted Bitstring status list plus an issuer
 * that signs operand-anchor VCs against it. Defaults to a genuine income
 * anchor for 2860, subject SUBJECT, status index 7.
 */
export async function anchorRig(): Promise<AnchorRig> {
  const host = stubHost();
  const list = await hostedStatusList(host);
  return {
    host,
    issue: async (overrides = {}) =>
      issueCredential({
        kind: "zk-operand-anchor",
        credentialId: "https://maya.pod.example/lending/credentials/income-anchor",
        issuer: ISSUER,
        subject: overrides.subject ?? SUBJECT,
        claims: {
          kind: "zk-operand-anchor",
          field: overrides.field ?? LEND.netMonthlyIncomeUsd,
          operandEnc: overrides.operandEnc ?? encOf(MAYA_INCOME),
        },
        validity: overrides.validity ?? BACKDATED_VALIDITY,
        status: list.entry(overrides.index ?? 7),
        key: await issuerKey(),
      }),
    revoke: (index) => list.revoke(index, { now: NOW }),
  };
}

/**
 * Issue a genuine anchor for each pre-qualification field, on distinct status
 * indices, plus the {@link StatusListClient} they were issued against - reuse
 * it (never call `hostedStatusList` a second time on the same host) so a test
 * that mints one more anchor doesn't try to `create()` the list twice.
 */
export async function anchorTrio(host: StubHost): Promise<{
  readonly list: Awaited<ReturnType<typeof hostedStatusList>>;
  readonly netMonthlyIncomeUsd: IssuedCredential;
  readonly cashFlowScoreValue: IssuedCredential;
  readonly nsf90Count: IssuedCredential;
}> {
  const list = await hostedStatusList(host);
  const issue = async (field: string, operandEnc: string, index: number) =>
    issueCredential({
      kind: "zk-operand-anchor",
      credentialId: `https://maya.pod.example/lending/credentials/${index}-anchor`,
      issuer: ISSUER,
      subject: SUBJECT,
      claims: { kind: "zk-operand-anchor", field, operandEnc },
      validity: BACKDATED_VALIDITY,
      status: list.entry(index),
      key: await issuerKey(),
    });
  const [netMonthlyIncomeUsd, cashFlowScoreValue, nsf90Count] = await Promise.all([
    issue(LEND.netMonthlyIncomeUsd, encOf(MAYA_INCOME), 31),
    issue(LEND.cashFlowScoreValue, encOf(MAYA_SCORE), 32),
    issue(LEND.nsf90Count, encOf(MAYA_NSF), 33),
  ]);
  return { list, netMonthlyIncomeUsd, cashFlowScoreValue, nsf90Count };
}
