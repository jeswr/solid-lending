/**
 * A single-use challenge-nonce store for the scene-2 pre-qualification rail
 * (`@lending/vc-kit`'s {@link TierANonceConsumer} contract). Process-local —
 * fine for this dev/demo scaffold's single instance; a multi-instance deploy
 * needs a shared store (same seam family as the mortgage showcase's own
 * documented residual for its DPoP jti replay store).
 */
import type { TierANonceConsumer } from "@lending/vc-kit";
import { randomUUID } from "node:crypto";

const NONCE_TTL_MS = 5 * 60 * 1000;

interface LiveChallenge {
  readonly nonce: string;
  readonly expiresAt: number;
}

const live = new Map<string, LiveChallenge>();

function sweep(now: number): void {
  for (const [sessionKey, challenge] of live) {
    if (challenge.expiresAt <= now) live.delete(sessionKey);
  }
}

/** Mint a fresh single-use challenge for a fresh session key. */
export function mintChallenge(now: () => Date = () => new Date()): {
  sessionKey: string;
  nonce: string;
} {
  const instant = now().getTime();
  sweep(instant);
  const sessionKey = randomUUID();
  const nonce = randomUUID();
  live.set(sessionKey, { nonce, expiresAt: instant + NONCE_TTL_MS });
  return { sessionKey, nonce };
}

/** The shared {@link TierANonceConsumer}: burns the challenge on first use,
 * regardless of outcome — a presenter gets exactly one shot per nonce. */
export const nonceConsumer: TierANonceConsumer = {
  consume(sessionKey: string, nonce: string): boolean {
    sweep(Date.now());
    const challenge = live.get(sessionKey);
    live.delete(sessionKey);
    return challenge !== undefined && challenge.nonce === nonce;
  },
};
