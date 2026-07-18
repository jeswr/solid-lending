/**
 * The four branded issuer flows (design §6.2, scene 1 "fill the vault"):
 * Identity (Socure-modelled, KYC/CIP), Employment+Income (The Work
 * Number-modelled, ZK-participating), Bank Cash-Flow (Mastercard Open
 * Banking-modelled, FDX-shaped, ZK-participating), and Cash-Flow Score
 * (Prism Data-modelled, derived-from the cash-flow VC, ZK-participating).
 *
 * Claims are PINNED to the walkthrough's single played borrower (Maya
 * Torres — `@lending/data-model`'s `PERSONA_VALUES[0]`) — a request can only
 * select a flow, never a value, so `/api/issue` can never become a signing
 * oracle. These are the SAME values `seeds/credentials.ts` issues at seed
 * time (the wallet's Mode-1 fast-forward), so the live issuer rail and a
 * seeded pod can never disagree about what a credential says, and the SAME
 * pod paths (`@lending/data-model`'s `RESOURCE_POD_PATHS` +
 * `@lending/seeds`'s `ANCHOR_POD_PATHS`) so a borrower who mixes seeding and
 * live issuance lands on one canonical resource per credential kind.
 *
 * Operand encodings are the CAPTURED genuine sparq term encodings (never
 * fabricated) — see `@lending/seeds/captured-operand-enc.ts`'s provenance
 * note (sparq `encode_int_literal`, captured by
 * `packages/vc-kit/scripts/capture-fixtures.mjs`).
 */
import {
  fitsZkBudget,
  LEND,
  PERSONA_VALUES,
  type PersonaValues,
  RESOURCE_POD_PATHS,
} from "@lending/data-model";
import { ANCHOR_POD_PATHS, capturedEncoding } from "@lending/seeds";
import type {
  BankCashFlowClaims,
  CashFlowScoreClaims,
  CredentialClaims,
  CredentialKind,
  EmploymentIncomeClaims,
  IdentityClaims,
} from "@lending/vc-kit";
import type { IssuerFlowId } from "./config";

/** The walkthrough's single played borrower (design §5, fictional; pinned). */
function mayaTorres(): PersonaValues {
  const values = PERSONA_VALUES[0];
  if (values === undefined || values.id !== "maya-torres") {
    throw new Error("@lending/data-model PERSONA_VALUES is missing the maya-torres persona");
  }
  return values;
}

const PERSONA = mayaTorres();

/** The ZK operand anchor a flow issues beside its credential. */
export interface FlowAnchorSpec {
  /** The hidden field IRI (one of the three §6.2 ZK-provable fields). */
  readonly field: string;
  /** Pod-root-relative path the anchor credential lands at. */
  readonly path: string;
}

export interface IssuerFlowDefinition {
  readonly id: IssuerFlowId;
  /** Role-first display label ("modelled on X" framing, never "by X"). */
  readonly label: string;
  /** The modelled organisation. */
  readonly modelledOn: string;
  /** The journey role. */
  readonly role: string;
  readonly kind: CredentialKind;
  /** Pod-root-relative credential path. */
  readonly credentialPath: string;
  /** Validity window offsets from the issue instant, in days. */
  readonly validFromDays: number;
  readonly validUntilDays: number;
  /**
   * The PINNED demo claims this flow signs (never request-supplied). `podBase`
   * is only consulted by the score flow's `prov:wasDerivedFrom` edge (it must
   * point at the CALLER'S bank cash-flow credential resource).
   */
  readonly claims: (podBase: string) => CredentialClaims;
  /** The operand anchor issued beside the credential, when the kind has one. */
  readonly anchor?: FlowAnchorSpec;
  /** The pinned hidden value the anchor attests (present iff `anchor` is). */
  readonly anchorValue?: number;
}

export const ISSUER_FLOWS: Readonly<Record<IssuerFlowId, IssuerFlowDefinition>> = {
  cashflow: {
    anchor: { field: LEND.nsf90Count, path: ANCHOR_POD_PATHS.nsf90 },
    anchorValue: PERSONA.nsf90Count,
    claims: (): BankCashFlowClaims => ({
      accountLast4: "4821",
      averageDailyBalanceUsd: PERSONA.averageDailyBalanceUsd,
      depositStreams: PERSONA.depositStreams.map((stream) => ({
        monthlyAmountUsd: stream.monthlyAmountUsd,
        name: stream.name,
      })),
      kind: "bank-cashflow-credential",
      nsf90Count: PERSONA.nsf90Count,
      observationMonths: PERSONA.observationMonths,
      provider: { name: PERSONA.bankName },
    }),
    credentialPath: RESOURCE_POD_PATHS["bank-cashflow-credential"],
    id: "cashflow",
    kind: "bank-cashflow-credential",
    label: "Bank cash-flow verification — modelled on Mastercard Open Banking",
    modelledOn: "Mastercard Open Banking",
    role: "financial account data aggregator (FDX)",
    validFromDays: -3,
    validUntilDays: 27,
  },
  identity: {
    anchor: undefined,
    claims: (): IdentityClaims => ({
      address: PERSONA.homeAddress,
      birthDate: PERSONA.birthDate,
      kind: "identity-credential",
      name: PERSONA.name,
    }),
    credentialPath: RESOURCE_POD_PATHS["identity-credential"],
    id: "identity",
    kind: "identity-credential",
    label: "Identity verification — modelled on Socure",
    modelledOn: "Socure",
    role: "identity verifier (KYC/CIP)",
    validFromDays: -60,
    validUntilDays: 305,
  },
  income: {
    anchor: { field: LEND.netMonthlyIncomeUsd, path: ANCHOR_POD_PATHS.income },
    anchorValue: PERSONA.netMonthlyIncomeUsd,
    claims: (): EmploymentIncomeClaims => ({
      employer: { name: PERSONA.employerName },
      jobTitle: PERSONA.jobTitle,
      kind: "employment-income-credential",
      netMonthlyIncomeUsd: PERSONA.netMonthlyIncomeUsd,
      startDate: PERSONA.employmentStartDate,
    }),
    credentialPath: RESOURCE_POD_PATHS["employment-income-credential"],
    id: "income",
    kind: "employment-income-credential",
    label: "Employment + income verification — modelled on The Work Number (Equifax)",
    modelledOn: "The Work Number (Equifax)",
    role: "employment and income verifier",
    validFromDays: -30,
    validUntilDays: 14,
  },
  score: {
    anchor: { field: LEND.cashFlowScoreValue, path: ANCHOR_POD_PATHS.score },
    anchorValue: PERSONA.cashFlowScoreValue,
    claims: (podBase: string): CashFlowScoreClaims => ({
      cashFlowScoreValue: PERSONA.cashFlowScoreValue,
      derivedFrom: `${podBase}${RESOURCE_POD_PATHS["bank-cashflow-credential"].slice(1)}`,
      kind: "cashflow-score-credential",
    }),
    credentialPath: RESOURCE_POD_PATHS["cashflow-score-credential"],
    id: "score",
    kind: "cashflow-score-credential",
    label: "Cash-flow score — modelled on Prism Data",
    modelledOn: "Prism Data",
    role: "cash-flow scoring consortium",
    validFromDays: -3,
    validUntilDays: 27,
  },
};

/**
 * The CAPTURED genuine encoding of a flow's anchored pinned-claim value —
 * re-gated against its ZK digit budget. An operand encoding is never
 * fabricated; a missing capture throws (fail closed) before any pod mutation.
 */
export function capturedEncodingFor(definition: IssuerFlowDefinition): string {
  if (definition.anchor === undefined || definition.anchorValue === undefined) {
    throw new Error(`flow ${definition.id} has no anchor`);
  }
  if (!fitsZkBudget(definition.anchor.field, definition.anchorValue)) {
    throw new Error(`flow ${definition.id}'s anchor value breaks its ZK digit budget`);
  }
  return capturedEncoding(definition.anchorValue);
}
