# wallet — the borrower's Data Vault (sm-qz3j.5)

Concept demonstration modelled on the **consumer data custodian** role (Verizon). Role-first
framing, no logos/trade dress, `noindex`, every figure illustrative. **Not affiliated with,
sponsored by, or endorsed by Verizon.**

The central app of the journey (design §6.1/§6.2, scenes 1–5): credential list, access
grants, the scene-2 pre-qualification proof, and the scene-5 consent-receipt + ODRL grant
ledger, over the five real signed lending VCs `@lending/seeds` writes into Maya Torres's pod.

## Surfaces

- **`/credentials`** — verify-on-view over the five seeded credentials (identity,
  employment+income, bank cash-flow, cash-flow score, credit score): the full fail-closed
  `verifyCredential` chain (signature, issuer key binding, validity window, revocation
  status, SHACL shape), re-run every load.
- **`/prequal`** — scene 2 "shop without stripping": proves `income >= $2,200/mo ∧
  cash-flow score >= 660 ∧ NSF₉₀ = 0` with `@lending/vc-kit`'s real sparq UltraHonk prover,
  bound to a single-use challenge, checked by the real fail-closed verifier
  (`verifyPreQualification`) — no underlying figure ever leaves the process except as a ZK
  proof.
- **`/grants`** — the access-grant dashboard (design §6.1's grant catalogue,
  `lib/grants/parties.ts` + `lib/grants/resources.ts`): grant or revoke ONE
  operator-configured party's access to ONE catalogue resource (a specific credential or
  lender-written document) at a time, through the real Mode-2 `/api/grants*` rail.
- **`/ledger`** — the scene-5 consent-receipt + ODRL grant ledger: every transition, DPV
  consent status + `odrl:target`, time-ordered.

## The grant/revoke engine (`lib/grants/engine.ts`)

Adapted from the solid-mortgage showcase's wallet engine (`apps/wallet/lib/grants/engine.ts`,
jeswr/solid-mortgage — read-only reference) to this demo's **resource-scoped** grant model:
"grant a lender read access to specific credentials" (the brief) is literal — a transition
targets exactly ONE pod resource's own WAC ACL (`@jeswr/solid-seed` already provisions each
credential owner-only at `${resourceIri}.acl`; the engine converges the SAME document), not a
whole container.

- ACLs are rebuilt from per-agent single-agent rules: `#owner` (borrower), optional
  `#service` (the wallet's Mode-2 service identity), one `#grant-…` rule per granted party.
- The authoritative consent-receipt ledger lives in a dedicated `/lending/receipts/`
  subcontainer whose OWN ACL admits writes from the borrower + wallet service ONLY —
  overriding the container's inherited default, so a write-granted party can never forge or
  poison a receipt. A pre-existing store is verify-only (never trusted blindly).
- **Revocation is immutable**: once withdrawn, a party can never be silently re-granted that
  resource. Repeats are loud 409 no-ops.
- A write grant on a not-yet-existing scene-3/4/5 document (loan offer, disbursement
  receipt, repayment history — the seeder only issues the five scene-1 credentials)
  idempotently provisions an empty placeholder first: WAC evaluates a resource CREATE
  against the parent container, not the not-yet-existing resource's own ACL, so a bare
  resource-level grant would otherwise be inert.
- The scene-5 repayment authorization (`lib/grants/odrl.ts`) is a real W3C ODRL 2.2 policy
  document (`odrl:Agreement`/`Permission`/`Constraint`) carrying the 12 CFR 1041 subpart C
  payment-provision rail as an inspectable `odrl:count <= 2` constraint rather than prose —
  built through `@rdfjs/wrapper` typed accessors (no hand-built triples), the same way the
  ACL documents beside it are.

**Known residual** (single-instance demo scope, tracked as a beaded follow-up): the mortgage
showcase's receipt store additionally closes a cross-instance create→lock race with a
readiness sentinel (auto-scaling deploys racing the FIRST-EVER grant). This app runs one
instance in dev/test/demo, so that race is not reachable here; the pre-existing-store lock is
still verified, just without the sentinel dance.

## Mode-2 grant rail boundary

Every `/api/grants*`+`/api/ledger` route runs through `@jeswr/solid-pod-guard`'s
`createPodRouteGuard` unmodified: a DPoP-bound Solid-OIDC caller (anonymous ⇒ 401), the pod
derived from the token WebID's bidirectional `pim:storage` binding (`pod`/`webid` overrides ⇒
400), and grants only to OPERATOR-CONFIGURED party WebIDs resolved from short ids — a request
can never name an arbitrary grantee. Pod IO runs over the wallet's own client-credentials
service identity (`LENDING_WALLET_POD_SERVICE_*`); unconfigured ⇒ 503, never anonymous IO.

See `.env.example` for the full variable list.

## The scene-2 pre-qualification rail

`@lending/vc-kit` re-exports `@jeswr/solid-vc`, whose published bundle statically imports
`node:crypto`/`node:zlib` — it cannot be pulled into a browser bundle without a build
failure. This scaffold ships no in-browser WASM runtime either (unlike the mortgage
showcase's Mode-1 SharedWorker pod — see `lib/server/dev-seed.ts`'s header for the same
already-documented gap), so `/prequal` is **browser-triggered, server-executed**: the click
POSTs to `/api/dev/prequal/challenge` then `/api/dev/prequal/prove` (Node runtime), which
reads + verifies the three ZK-provable credentials and their operand anchors
(`lib/server/prequal-witness.ts`), proves with the real sparq prover, and immediately
verifies with the real fail-closed verifier. Both routes are dev-gated exactly like
`/api/dev/seed`.

**Known demo-scope limitation**: there is no live lender rail in this repo yet
(`bank-lender`/`fintech-lender` are still scaffolds) to VP-POST the proof to, so
`lib/server/prequal-service.ts` stands in as BOTH challenger and verifier — a self-check the
UI narrates honestly via its Honesty Panel, never hidden. Nothing in the proof, the anchor
binding, or the verifier's nine fail-closed gates is more lenient than a real lender rail
would be.

## Known demo-scope limitations

- **No borrower login UI yet** — `/grants` and `/ledger` call the real Mode-2 rail, which
  needs a real DPoP-bound Solid-OIDC session; a deployed visitor without one sees the rail's
  own honest 401 (never a fake bypass). The rail itself is exercised end-to-end by
  `test/grant-rail.test.ts` with real sessions. Same gap the mortgage showcase's own wallet
  documents.
- **Process-local stores** — the pre-qualification nonce store
  (`lib/server/prequal-nonces.ts`) and the grant engine's per-(pod,resource) transition lock
  are process-local; a multi-instance deploy needs the shared-store swap.
- **`@lending/test-kit`'s bundled OIDC dev issuer needed a narrow upstream fix** (this PR):
  its minted access tokens were missing the `typ`/`sub` claims `@jeswr/solid-api-auth`'s
  `DpopApiVerifier` requires (RFC 9068) — every `@jeswr/solid-pod-guard`-fronted route was
  rejecting them 401 before reaching any app logic. Fixed narrowly in
  `packages/test-kit/src/harness.ts` (adds the two claims; default behaviour otherwise
  unchanged — verified against the seeder's own regression suite). The bundled issuer's
  WebID claims stay `http:`, which `@jeswr/solid-api-auth` hard-rejects with no loopback
  exception (unlike the pod-base check); `test/support/caller-issuer.ts` mints a SEPARATE
  `https:`-webid dev issuer for the caller side of pod-guard routes specifically, mirroring
  the sibling `verifications` app's own test helper.
