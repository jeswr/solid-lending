/**
 * A single-use, TTL-bounded challenge-nonce store for the scene-2 VP-POST
 * rail (satisfies vc-kit's `TierANonceConsumer` seam: `consume(sessionKey,
 * nonce): boolean`). One live challenge per session key at a time — minting
 * again REPLACES the previous nonce (so a stale challenge can never be
 * consumed after a fresh one was issued), and `consume` is single-use: a
 * MATCHING nonce is deleted immediately, so a captured/observed nonce cannot
 * be replayed even within its TTL. A non-matching attempt does NOT burn the
 * still-live challenge (matches vc-kit's own nonce-store test-double
 * contract) — a presenter who mis-sends can still retry with the right one;
 * the verifier's own gate chain (not this store) is what stops a forged
 * presentation.
 *
 * In-process only (matches the app's other rate limiters/nonce stores across
 * this workspace) — a multi-instance deployment needs a shared store; the
 * interface is narrow enough to swap for one without touching call sites.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export interface NonceStore {
  /** Mint a fresh single-use nonce for `sessionKey`, replacing any prior live one. */
  mint(sessionKey: string): string;
  /** `true` IFF `nonce` is the live, unexpired nonce for `sessionKey`; consumes it either way it matches. */
  consume(sessionKey: string, nonce: string): boolean;
}

interface Entry {
  readonly nonce: string;
  readonly expiresAtMs: number;
}

export function createNonceStore(options: { ttlMs?: number; now?: () => number } = {}): NonceStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();

  return {
    mint(sessionKey: string): string {
      const nonce = crypto.randomUUID();
      entries.set(sessionKey, { expiresAtMs: now() + ttlMs, nonce });
      return nonce;
    },
    consume(sessionKey: string, nonce: string): boolean {
      const entry = entries.get(sessionKey);
      if (entry === undefined) return false;
      if (entry.expiresAtMs < now()) {
        entries.delete(sessionKey);
        return false;
      }
      if (entry.nonce !== nonce) return false;
      // Matched: burn it. Exactly one successful consume per mint.
      entries.delete(sessionKey);
      return true;
    },
  };
}
