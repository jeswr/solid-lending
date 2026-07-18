/**
 * The bureau's ONE issued credential (design §6.2 row 5, scenes 1 and 3): the
 * traditional bureau Credit Score VC — the "old rail" the bank-lender's
 * bureau-only decision reads in scene 3, and (design §1) the thin-file
 * near-prime score a cash-flow-only rail approves where this one prices out
 * or declines.
 *
 * Claims are PINNED to the walkthrough's single played borrower (Maya
 * Torres — `@lending/data-model`'s `PERSONA_VALUES[0]`) — a request can only
 * hit `/api/issue`, never select or supply a value, so this route can never
 * become a signing oracle. These are the SAME values `seeds/credentials.ts`
 * issues at seed time, and the SAME pod path (`@lending/data-model`'s
 * `RESOURCE_POD_PATHS`), so the live issuer rail and a seeded pod can never
 * disagree about what this credential says or where it lives.
 */
import { PERSONA_VALUES, type PersonaValues, RESOURCE_POD_PATHS } from "@lending/data-model";
import type { CreditScoreClaims } from "@lending/vc-kit";

/** The walkthrough's single played borrower (design §5, fictional; pinned). */
function mayaTorres(): PersonaValues {
  const values = PERSONA_VALUES[0];
  if (values === undefined || values.id !== "maya-torres") {
    throw new Error("@lending/data-model PERSONA_VALUES is missing the maya-torres persona");
  }
  return values;
}

const PERSONA = mayaTorres();

/** Pod-root-relative path the Credit Score VC lands at. */
export const CREDIT_SCORE_CREDENTIAL_PATH = RESOURCE_POD_PATHS["credit-score-credential"];

/**
 * Validity window offsets (days from issuance) — matches
 * `seeds/credentials.ts`'s `creditScore` window verbatim, so a live-issued
 * credential and a seeded one share the same freshness story.
 */
export const CREDIT_SCORE_VALID_FROM_DAYS = -10;
export const CREDIT_SCORE_VALID_UNTIL_DAYS = 80;

/** Maya's pinned thin-file bureau score (design §1: 612, near-prime; priced out on bureau data alone). */
export function creditScoreClaims(): CreditScoreClaims {
  return {
    creditHistoryMonths: PERSONA.creditHistoryMonths,
    creditScoreValue: PERSONA.creditScoreValue,
    kind: "credit-score-credential",
    tradelineCount: PERSONA.tradelineCount,
  };
}
