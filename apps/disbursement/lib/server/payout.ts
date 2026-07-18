/**
 * DETERMINISTIC simulated push-to-card payout (scene 4 — the demo's
 * "funded in minutes" beat). Pure function of `now`: no randomness, no
 * network, no real money movement — matching the fintech-lender
 * underwriting engine's own determinism contract (design §9: "no money
 * moves"). The settlement duration is a FIXED constant well inside the
 * Mastercard-Send-modelled ≤30-minute push-to-card window (design §6.3
 * `instant` anchor) — the walkthrough's contrast card is "minutes, not up to
 * seven days".
 */

/** Illustrative settlement duration — comfortably inside the ≤30-min push-to-card beat. */
export const SETTLEMENT_MINUTES = 11;

const SETTLEMENT_MS = SETTLEMENT_MINUTES * 60_000;

/** The push-to-card rail's stated outer bound (design §6.3 `instant` anchor). */
export const MAX_SETTLEMENT_MINUTES = 30;

/**
 * The demo's illustrative card-on-file — no real PAN, no real card, and
 * never accepted from a request (the rail's own concern, not the caller's;
 * see the module header on `fundingInstruction.ts` — this rail sees the
 * payment instruction only, nothing about "which card" is borrower-supplied
 * here).
 */
export const DEMO_CARD_LAST4 = "5137";

export interface SimulatedPayout {
  readonly initiatedAt: Date;
  readonly settledAt: Date;
  readonly cardLast4: string;
}

/** Run the simulated payout as of `now`. Byte-identical output for identical input. */
export function runSimulatedPayout(now: Date): SimulatedPayout {
  return {
    cardLast4: DEMO_CARD_LAST4,
    initiatedAt: now,
    settledAt: new Date(now.getTime() + SETTLEMENT_MS),
  };
}
