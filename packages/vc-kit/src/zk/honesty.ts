/**
 * The MANDATORY ZK honesty-panel content (decision 0005 posture carried over
 * from the mortgage showcase, design §6.5), as structured data for any
 * `HonestyPanel`-style surface. EVERY ZK surface renders these items - a ZK
 * feature without the honesty panel must not ship. Content is deliberately
 * plain strings so apps can render it in any component; tests pin the
 * load-bearing phrases so copy drift is caught.
 */

import {
  PINNED_BB_JS_VERSION,
  PINNED_NARGO_VERSION,
  PINNED_NOIR_JS_VERSION,
} from "./circuits/registry.ts";

export interface HonestyItem {
  /** Stable identifier (UI keys, tests). */
  readonly id: string;
  readonly title: string;
  readonly body: string;
}

/** The pinned proving toolchain. */
export const ZK_TOOLCHAIN = Object.freeze({
  noirJs: `@noir-lang/noir_js@${PINNED_NOIR_JS_VERSION}`,
  bbJs: `@aztec/bb.js@${PINNED_BB_JS_VERSION}`,
  nargo: `nargo ${PINNED_NARGO_VERSION}`,
  proofSystem: "Barretenberg UltraHonk (BN254, transparent - no trusted setup)",
  verifierTarget: "evm" as const,
});

/** The honesty items, in display order. */
export const ZK_HONESTY_ITEMS: readonly HonestyItem[] = Object.freeze([
  {
    id: "research-grade",
    title: "Research-grade cryptography, external audit pending",
    body:
      "The sparq zero-knowledge estate is research-grade: internally re-audited but " +
      "pending external cryptographer sign-off. A passing proof here is a research " +
      "demonstration, not a production cryptographic guarantee.",
  },
  {
    id: "pre-qualification-scope",
    title: "Zero-knowledge proof is scoped to pre-qualification ONLY",
    body:
      "This ZK rail proves exactly one thing to a shopping lender: that the borrower's " +
      "hidden monthly income, cash-flow score and 90-day NSF count satisfy this demo's " +
      "pre-qualification thresholds - nothing else, and nothing is disclosed. Once a " +
      "borrower moves past shopping into a priced offer or application with a lender, " +
      "the underlying values are disclosed via ordinary signed credentials, never " +
      "re-proved without disclosure. ZK never substitutes for underwriting decisioning.",
  },
  {
    id: "digit-budget-leak",
    title: "The circuit choice leaks the value's digit count",
    body:
      "Each threshold or equality statement uses a fixed-width circuit member sized to " +
      "the hidden value's own decimal digit count (1-4 digits across this demo's three " +
      "fields), so a verifier learns ceil(log10(value)) of the hidden operand - e.g. " +
      "that a monthly income has 4 digits, or that a zero NSF count used the narrowest " +
      "1-digit member. This envelope leak is documented in the circuit sources and is " +
      "inherent to the current family.",
  },
  {
    id: "low-entropy-enumeration",
    title: "Low-entropy values can be narrowed by enumeration",
    body:
      "Term encodings are deterministic and salt-free, so a determined verifier can " +
      "enumerate candidate values (551 possible cash-flow scores; 100 possible NSF " +
      "counts; ~10,000 possible 4-digit monthly incomes) and compare encodings. The " +
      "honest guarantee is 'not disclosed and not forgeable' - never 'cannot possibly " +
      "be learned'. Identical values also produce identical encodings across issuers " +
      "(linkability).",
  },
  {
    id: "toolchain-pins",
    title: "The toolchain is pinned - versions matter",
    body:
      `Proving and verifying run ${ZK_TOOLCHAIN.noirJs} + ${ZK_TOOLCHAIN.bbJs} over ` +
      `circuits compiled with ${ZK_TOOLCHAIN.nargo} (${ZK_TOOLCHAIN.proofSystem}). ` +
      "Public-input byte layout can change across bb.js nightlies, so every component " +
      "pins exact versions; proofs use the 'evm' flavour, which stays fully " +
      "zero-knowledge - the *-no-zk flavours are rejected outright.",
  },
  {
    id: "tier-a-binding",
    title: "Live proofs are bound to an issuer-signed operand anchor",
    body:
      "A live threshold proof alone is forgeable: anyone can compute the encoding of " +
      "any value and prove a true statement about it. Every live (Tier A) proof is " +
      "therefore checked against an issuer-signed operand-anchor credential - the " +
      "verifier requires the anchor's signature, its revocation status, its subject " +
      "(the presenter's WebID), its field, and the exact equality of its anchored " +
      "encoding with the proof's public input, plus a single-use challenge minted " +
      "for this session. If any check fails, the proof is rejected.",
  },
  {
    id: "shared-nonce-conjunction",
    title: "The three-field pre-qualification proof shares one challenge",
    body:
      "This demo's predicate spans three independently-issued credentials (income, " +
      "cash-flow score, NSF history), each with its own operand anchor. There is no " +
      "single circuit proving all three at once, so the wallet produces three separate " +
      "Tier A proofs bound to the SAME lender-minted nonce - the lender burns that " +
      "nonce exactly once and accepts the presentation only if every leg verifies.",
  },
]);

/** The full panel payload apps feed into a HonestyPanel-style component. */
export const ZK_HONESTY = Object.freeze({
  headline:
    "Real zero-knowledge cryptography with honestly-stated limits: research-grade, " +
    "externally unaudited, scoped to pre-qualification only, and leakier than " +
    "production ZK systems would be.",
  items: ZK_HONESTY_ITEMS,
  toolchain: ZK_TOOLCHAIN,
  /**
   * Multithreaded proving needs cross-origin isolation: apps set COOP
   * (`same-origin`) + COEP (`require-corp`) response headers; without them
   * proving still works, single-threaded (~4x slower).
   */
  coopCoep: "COOP: same-origin + COEP: require-corp enable multithreaded proving",
});
