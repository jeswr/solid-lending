/**
 * Copy-drift guard for the MANDATORY ZK honesty panel (docs/zk-plan.md;
 * decision 0005 posture carried over) - a ZK surface without this content
 * must not ship, so the load-bearing phrases are pinned here.
 */

import { describe, expect, it } from "vitest";
import {
  PINNED_BB_JS_VERSION,
  PINNED_NARGO_VERSION,
  PINNED_NOIR_JS_VERSION,
  ZK_HONESTY,
  ZK_HONESTY_ITEMS,
  ZK_TOOLCHAIN,
} from "../src/index.ts";

describe("ZK_HONESTY", () => {
  it("declares the pre-qualification-only scope (decision 0005 posture)", () => {
    const item = ZK_HONESTY_ITEMS.find((entry) => entry.id === "pre-qualification-scope");
    expect(item).toBeDefined();
    expect(item?.body).toContain("pre-qualification");
    expect(item?.body).toMatch(/disclosed/i);
  });

  it("states research-grade / externally-unaudited honestly", () => {
    const item = ZK_HONESTY_ITEMS.find((entry) => entry.id === "research-grade");
    expect(item?.body).toContain("research-grade");
    expect(item?.body).toContain("audit");
    expect(ZK_HONESTY.headline).toContain("research-grade");
  });

  it("documents the mandatory operand-anchor binding", () => {
    const item = ZK_HONESTY_ITEMS.find((entry) => entry.id === "tier-a-binding");
    expect(item?.body).toContain("anchor");
    expect(item?.body).toContain("single-use challenge");
  });

  it("documents the digit-count leak and low-entropy enumerability - never overclaims", () => {
    const leak = ZK_HONESTY_ITEMS.find((entry) => entry.id === "digit-budget-leak");
    const enumerable = ZK_HONESTY_ITEMS.find((entry) => entry.id === "low-entropy-enumeration");
    expect(leak?.body).toContain("digit count");
    expect(enumerable?.body).toContain("not disclosed and not forgeable");
    // The honest guarantee is a negation, never an absolute claim of secrecy.
    expect(enumerable?.body).toContain("never 'cannot possibly be learned'");
  });

  it("documents the shared-nonce three-field conjunction", () => {
    const item = ZK_HONESTY_ITEMS.find((entry) => entry.id === "shared-nonce-conjunction");
    expect(item?.body).toContain("SAME");
    expect(item?.body).toContain("nonce");
  });

  it("pins the toolchain versions exactly", () => {
    expect(ZK_TOOLCHAIN.noirJs).toBe(`@noir-lang/noir_js@${PINNED_NOIR_JS_VERSION}`);
    expect(ZK_TOOLCHAIN.bbJs).toBe(`@aztec/bb.js@${PINNED_BB_JS_VERSION}`);
    expect(ZK_TOOLCHAIN.nargo).toBe(`nargo ${PINNED_NARGO_VERSION}`);
    expect(ZK_TOOLCHAIN.verifierTarget).toBe("evm");
  });

  it("every item has a stable id, title and non-empty body", () => {
    const ids = new Set<string>();
    for (const item of ZK_HONESTY_ITEMS) {
      expect(item.id.length).toBeGreaterThan(0);
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.body.length).toBeGreaterThan(0);
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
    }
  });
});
