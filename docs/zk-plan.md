# ZK plan — seam note (sm-qz3j.2 / sm-qz3j.3)

> Where the anchor round stopped and the Tier-A prover round picked up. Mirrors the mortgage
> showcase's decision 0005 (`solid-mortgage/decisions/0005-zk-encodings.md`) and
> `docs/research/zkp-fit.md`, scoped to the lending design (§6.2/§6.5 of
> `solid-mortgage/docs/research/small-dollar-lending-design.md`).

## Scope of the Tier-A prover round (sm-qz3j.3 — done)

- `packages/vc-kit/src/zk/` — the Tier-A live prove/verify layer, ported from the mortgage
  showcase's `zk/` and adapted to the demo's `income ≥ 2200 ∧ cash-flow score ≥ 660 ∧
  NSF₉₀ = 0` conjunction (design §6.2 scene 2):
  - `circuits/registry.ts` + `circuits/filter-int-d{1,2,3,4}.ts` — FOUR committed circuit
    artifacts, compiled with the pinned `nargo 1.0.0-beta.21` directly from the SAME pinned
    sparq checkout commit (`947480b02fcbd174f80f9247b55ee02202d2e345`) the anchor round's
    fixtures already verify against. `filter_int_d1` is a genuine addition beyond the
    mortgage showcase's `{d2,d3,d4}` set: the canonical digit encoding of `NSF₉₀ = 0` is the
    single ASCII digit `"0"` (the circuit forbids a leading zero for `D > 1`), so a real
    zero-NSF proof is only satisfiable against the 1-digit member. Cross-checked two ways:
    bytecode is byte-identical to the mortgage showcase's own committed `d2`/`d3`/`d4`
    artifacts, and `d2`'s bytecode is byte-identical to the sparq repo's own shipped
    `site/public/zk/filter_int_d2.json` (the car-hire age-gate circuit).
  - `backend.ts` — the same pinned-toolchain UltraHonk plumbing (`@noir-lang/noir_js@1.0.0-beta.21`
    + `@aztec/bb.js@5.0.0-nightly.20260324`, `evm` flavour only).
  - `prover.ts` / `verifier.ts` — `proveTierA`/`verifyTierA` (single-statement, generalised to
    the `ge`/`eq` operators this demo needs — sparq's `filter_int` ABI already has `OP_EQ`),
    PLUS `provePreQualification`/`verifyPreQualification`: the demo's three-field conjunction
    as three independent Tier-A proofs sharing ONE lender-minted nonce (there is no native
    circuit for a multi-column AND in this pinned checkout). Gate ordering: structural checks
    run for every leg BEFORE the shared nonce is ever touched, so a malformed presentation
    never burns a live challenge; the nonce burns exactly once for the whole bundle.
  - `honesty.ts` — the mandatory honesty-panel content (research-grade, digit-count leak,
    low-entropy enumerability, pinned toolchain, mandatory anchor binding, the shared-nonce
    three-field conjunction) plus an explicit **pre-qualification-only scope** item carrying
    decision 0005's posture forward: once a borrower moves past shopping into a priced offer
    or application, values are disclosed via ordinary signed credentials, never re-proved
    without disclosure.
- Real coverage, no stubs: `test/zk-prover.test.ts` / `test/zk-tier-a.test.ts` /
  `test/zk-prequalification.test.ts` / `test/zk-registry.test.ts` prove and verify GENUINE
  UltraHonk transcripts in Node (bb.js/noir_js run outside the browser too, so this needed no
  headless-browser harness) — satisfying witnesses accept, non-satisfying witnesses are
  UNSATISFIABLE at the witness-solve stage (no proof exists, not a false proof), and the full
  decision-0012 forgeability/replay/tamper negative matrix is exercised, including a
  three-field bundle scenario where two legs are genuine and one is forged. `500` was added to
  `DEMO_OPERAND_VALUES` (`seed-tooling/demo.ts`) and `capture:fixtures` re-run for real against
  the pinned checkout — a genuine in-budget, below-threshold cash-flow score the prover's
  UNSATISFIABLE coverage needed; every previously-captured encoding stayed byte-identical.
  The in-browser proving UI (COOP/COEP headers, the pre-qualification flow's honesty-panel
  wiring, a headless-browser e2e proof) is left for the journey e2e round — this round's Node
  coverage already exercises the real cryptography end-to-end.

## Scope of the anchor round (sm-qz3j.2 — done)

- The three §6.2 scene-2 ZK-provable fields, their digit budgets and inclusive bounds
  (`@lending/data-model`'s `ZK_FIELD_BUDGETS`, `packages/data-model/src/zk-budgets.ts`):

  | Field | Statement | Encoding | Circuit |
  |---|---|---|---|
  | `lend:netMonthlyIncomeUsd` | ≥ $2,200/mo | 4-digit, `0..9999` | `filter_int_d4` |
  | `lend:cashFlowScoreValue` | ≥ 660 | 3-digit, `300..850` | `filter_int_d3` |
  | `lend:nsf90Count` | = 0 (equality-to-zero) | 2-digit, `0..99` | `filter_int_d2` |

- `lend:ZkOperandAnchor` credentials (SHACL-gated, `shapes/zk-operand-anchor.ttl`): an
  issuer-signed `eddsa-rdfc-2022` VC per hidden field, binding `lend:field` + `lend:operandEnc`
  to the subject — the anchor a Tier-A verifier will check a proof's public operand against.
- `@lending/vc-kit/seed-tooling`: `mintOperandAnchors` reads the EXACT `xsd:integer` literal a
  credential's wrappers wrote (never a re-parsed string), computes its `encode_int_literal` term
  encoding via the native sparq bridge, and mints the anchor through the ordinary issuance gate
  (SHACL before signature). `dualSignCredential` adds the Schnorr-over-Baby-JubJub attestation
  (Poseidon2 commitment of the RDFC-1.0 canonical claim graph, status-bound) as a borrower-only
  JSON witness resource beside the VC — never embedded in the VC's RDF (sparq has no RDF
  embedding for `poseidon2-schnorr-v1`; `@jeswr/solid-vc` implements `eddsa-rdfc-2022` only).
  `SparqCredentialSeedPipeline.issue()` does all three (VC + anchors + witness) in one call so
  outputs stay mutually consistent.
- Real coverage: `packages/vc-kit/test/seed-tooling.test.ts` mints genuine anchors for all three
  fields (income 2860, cash-flow score 720, NSF₉₀ 0) against the captured `encode_int_literal`
  fixtures (`test/fixtures/operand-enc.json`, `PROVENANCE.json` records the sparq checkout
  commit + capture toolchain — genuinely captured, never fabricated) and verifies each anchor VC
  through the real verifier + SHACL + hosted Bitstring status list. `seed-tooling-native.test.ts`
  is the gated (SPARQ_CHECKOUT + cargo) integration test that reproduces those fixtures
  byte-for-byte against the live native helper; it is skipped in this environment (no local
  sparq checkout) and in ordinary CI, same as the mortgage showcase's pattern.

## Explicitly OUT of scope through the Tier-A round

- **Tier-B composite manifests** (`join_eq` same-subject linking, hidden-index revocation,
  hidden-issuer membership) and the `manifest-capture.ts` module that assembles them — the
  mortgage showcase's equivalent lives behind its own `zk/` circuit-registry surface, which this
  repo does not have yet, and this demo's predicate needs no cross-credential composition (each
  leg of the conjunction is a single-field statement).
- Any in-browser ZK UI (the pre-qualification proof flow's screens, COOP/COEP response headers
  for multithreaded proving, the honesty panel's rendered surface) and the corresponding
  Playwright e2e coverage — `packages/vc-kit/src/zk/` proves/verifies genuinely in Node, but no
  app route calls it yet.

## What the next round needs to land

1. Wire `provePreQualification`/`verifyPreQualification` into the `wallet` (prove) and
   `bank-lender`/`fintech-lender` (verify) apps: a route that mints the shared challenge nonce
   (an injected `TierANonceConsumer`, e.g. an in-memory or KV-backed store keyed by session), a
   pre-qualification screen that renders {@link ZK_HONESTY} verbatim beside the prove button,
   and COOP/COEP response headers (`next.config`) for multithreaded bb.js proving.
2. A cross-app Playwright e2e (`e2e/`) that drives the real in-browser proving path end-to-end
   (wallet holds the hidden values + anchors → lender mints a nonce → wallet proves → lender
   verifies) — this round's Node coverage already exercises the identical cryptography, so the
   e2e's job is the UI/transport wiring, not re-proving the ZK properties.
3. If a future scene needs a fourth ZK-provable field, extend `ZK_FIELD_BUDGETS`
   (`packages/data-model/src/zk-budgets.ts`) and re-run `capture:fixtures` against the pinned
   checkout — never hand-edit `test/fixtures/*.json`.
