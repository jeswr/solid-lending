import { describe, expect, it } from "vitest";
import { createNonceStore } from "../lib/server/nonce-store";

describe("createNonceStore", () => {
  it("mints a nonce that consume() accepts exactly once", () => {
    const store = createNonceStore();
    const nonce = store.mint("session-a");
    expect(store.consume("session-a", nonce)).toBe(true);
    expect(store.consume("session-a", nonce)).toBe(false);
  });

  it("a wrong nonce is rejected but does NOT burn the still-live challenge", () => {
    const store = createNonceStore();
    const nonce = store.mint("session-a");
    expect(store.consume("session-a", "not-the-nonce")).toBe(false);
    expect(store.consume("session-a", nonce)).toBe(true);
  });

  it("minting again for the same session REPLACES the previous live nonce", () => {
    const store = createNonceStore();
    const first = store.mint("session-a");
    const second = store.mint("session-a");
    expect(store.consume("session-a", first)).toBe(false);
    expect(store.consume("session-a", second)).toBe(true);
  });

  it("nonces are scoped per session key", () => {
    const store = createNonceStore();
    const nonce = store.mint("session-a");
    expect(store.consume("session-b", nonce)).toBe(false);
    expect(store.consume("session-a", nonce)).toBe(true);
  });

  it("an expired nonce is rejected", () => {
    let now = 0;
    const store = createNonceStore({ now: () => now, ttlMs: 1000 });
    const nonce = store.mint("session-a");
    now = 2000;
    expect(store.consume("session-a", nonce)).toBe(false);
  });

  it("consume() on an unknown session is false without throwing", () => {
    const store = createNonceStore();
    expect(store.consume("never-minted", "anything")).toBe(false);
  });
});
