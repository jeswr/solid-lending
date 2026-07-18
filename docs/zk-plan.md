# ZK plan — seam note (sm-qz3j.2)

> Where this round stops and the next round (the ZK prover) picks up. Mirrors the mortgage
> showcase's decision 0005 (`solid-mortgage/decisions/0005-zk-encodings.md`) and
> `docs/research/zkp-fit.md`, scoped to the lending design (§6.2/§6.5 of
> `solid-mortgage/docs/research/small-dollar-lending-design.md`).

## Scope of THIS round (sm-qz3j.2 — done)

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

## Explicitly OUT of scope this round

- **The Tier-A prover itself** (`proveTierA` / `verifyTierA`, `noir_js` + `bb.js` circuit
  execution in-browser). No proof is produced or verified anywhere in this repo yet — only the
  anchors a future proof will bind to.
- **Tier-B composite manifests** (`join_eq` same-subject linking, hidden-index revocation,
  hidden-issuer membership) and the `manifest-capture.ts` module that assembles them — the
  mortgage showcase's equivalent lives behind its own `zk/` circuit-registry surface, which this
  repo does not have yet.
- Any in-browser ZK UI (pre-qualification proof flow, honesty panel copy, COOP/COEP headers for
  multithreaded proving).

## What the next round needs to land

1. Pin the sparq checkout commit + toolchain versions (`noir_js`, `bb.js`) the way decision 0005
   pins them for the mortgage build; vendor or document the `zk/compose` circuit workspace this
   repo's `filter_int_d2/d3/d4` members live in.
2. Port `proveTierA`/`verifyTierA` (or the composite equivalent) scoped to the three fields
   above — the anchors and digit budgets this round produced are exactly their inputs.
3. Every ZK surface carries the honesty panel this round's `ZK_WITNESS_HONESTY_NOTE`
   (`packages/vc-kit/src/seed-tooling/pipeline.ts`) already states in miniature: research-grade,
   not externally audited, concept demonstration only. Carry that language into any UI.
4. Re-run `capture:fixtures` against the pinned checkout once the Tier-A workspace is wired in,
   so the operand-encoding fixtures this round captured stay the source of truth (never hand-edit
   `test/fixtures/*.json`).
