/**
 * The deterministic simulated payout: no randomness, no clock reads —
 * byte-identical output for identical `now`, and the settlement window stays
 * comfortably inside the ≤30-minute push-to-card beat the demo dramatizes.
 */
import { expect, test } from "vitest";
import {
  DEMO_CARD_LAST4,
  MAX_SETTLEMENT_MINUTES,
  runSimulatedPayout,
  SETTLEMENT_MINUTES,
} from "../lib/server/payout";

test("is a pure function of `now` — identical input, identical output", () => {
  const now = new Date("2026-07-16T14:02:00.000Z");
  const a = runSimulatedPayout(now);
  const b = runSimulatedPayout(now);
  expect(a).toEqual(b);
});

test("settles strictly after initiation, comfortably inside the <=30-min beat", () => {
  const now = new Date("2026-07-16T14:02:00.000Z");
  const payout = runSimulatedPayout(now);
  expect(payout.initiatedAt.getTime()).toBe(now.getTime());
  expect(payout.settledAt.getTime()).toBeGreaterThan(payout.initiatedAt.getTime());
  const minutes = (payout.settledAt.getTime() - payout.initiatedAt.getTime()) / 60_000;
  expect(minutes).toBe(SETTLEMENT_MINUTES);
  expect(minutes).toBeLessThanOrEqual(MAX_SETTLEMENT_MINUTES);
});

test("the destination card is a masked four-digit display value, never a full PAN", () => {
  const payout = runSimulatedPayout(new Date());
  expect(payout.cardLast4).toBe(DEMO_CARD_LAST4);
  expect(payout.cardLast4).toMatch(/^[0-9]{4}$/);
});

test("different `now` inputs still respect the fixed settlement duration", () => {
  const first = runSimulatedPayout(new Date("2026-01-01T00:00:00.000Z"));
  const second = runSimulatedPayout(new Date("2026-06-15T09:30:00.000Z"));
  expect(first.settledAt.getTime() - first.initiatedAt.getTime()).toBe(
    second.settledAt.getTime() - second.initiatedAt.getTime(),
  );
});
