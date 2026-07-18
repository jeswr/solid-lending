/**
 * PROVENANCE: genuine sparq term encodings of `"<value>"^^xsd:integer` from
 * `sparq_zk_compose::build::encode_int_literal`, captured by
 * `packages/vc-kit/scripts/capture-fixtures.mjs` against sparq commit
 * `947480b02fcbd174f80f9247b55ee02202d2e345` (2026-07-18) — copied verbatim from
 * `packages/vc-kit/test/fixtures/operand-enc.json` / `PROVENANCE.json` (a vc-kit TEST
 * fixture, not a package export, so the table is duplicated here with citation rather
 * than imported across the package boundary — the same pattern solid-mortgage's
 * `packages/solid-kit/src/mortgage-seed/overrides.ts` uses for its own captured table).
 *
 * This is exactly the table Maya Torres's three ZK-anchorable field values need:
 * netMonthlyIncomeUsd = 2860, cashFlowScoreValue = 720, nsf90Count = 0 (design §5, pinned
 * above the scene-2 thresholds — packages/data-model/src/personas.ts).
 *
 * NEVER hand-edit; an operand encoding is never fabricated — recapture with the native
 * toolchain instead (`SPARQ_CHECKOUT=<checkout> pnpm --filter @lending/vc-kit run
 * capture:fixtures`) and copy the refreshed table here.
 *
 * `mintOperandAnchors`/`SparqNativeBridge` (`@lending/vc-kit/seed-tooling`) are
 * DELIBERATELY not used here: that subpath's Node-only native bridge
 * (`packages/vc-kit/src/seed-tooling/native.ts`) resolves a filesystem path via
 * `new URL("../../scripts/sparq-helper", import.meta.url)`, which Turbopack/webpack
 * static analysis misreads as an unresolvable module import the moment any app bundles
 * `seeds/` (the wallet's dev-gated Mode-1 route does) — the same reason
 * solid-mortgage's own wallet worker (`apps/wallet/lib/pod/seed.ts`) mints its anchors
 * directly through plain `issueCredential` instead of through the seed-tooling barrel.
 * The anchor VC this table backs is issued and SHACL-gated exactly the same way either
 * path produces — only the (unused, Node-CLI-only) attestation/composite job plumbing is
 * skipped. Reported for beading: vc-kit's `seed-tooling` barrel could lazily
 * `await import()` `native.ts` so bundler-safe consumers of `mintOperandAnchors` alone
 * never pull in the filesystem-path expression.
 */
export const CAPTURED_OPERAND_ENC: Readonly<Record<number, string>> = {
  0: "0x17371a31fd5b665a45225290dde2708b5a90e4181a6cffc057103fb7a5b19c66",
  99: "0x2d1ae908575923f3c1074b9144297485c306d07b904ca775a0c592837bd7fa28",
  660: "0x0ce59c1353ad4549d10c4e684dc616a86df4294d0bbe4e22e149d9a5a8637437",
  720: "0x03991f97cea18f61d22cb2f762ddddfdfb03ed9ad32625cbbb3962bb2d59e59e",
  850: "0x06ee7437d5fcd1ec1ae9be425fd0e1dbd0dcb911514521f0d7a8dd21a72a1b20",
  2200: "0x1c1ba019a5ac42ec772999f33f1dbc57480afa339b59ba064cce4da00b82fc54",
  2860: "0x07b66a6df9e52198d3d823f29c5030fd9721dafcf31b7a44da67a0f21d3710b0",
  9999: "0x0ad5c5f2163a0400c5cd2a1a80fb43229689797c2b53ac9f93c6af28930e3c91",
};

/** The captured genuine sparq term encoding of `value`. Throws (never fabricates) when
 * `value` was not captured — recapture with the native toolchain instead. */
export function capturedEncoding(value: number): string {
  const encoding = CAPTURED_OPERAND_ENC[value];
  if (encoding === undefined) {
    throw new Error(
      `no captured operand encoding for ${value} — recapture with the native toolchain ` +
        "(packages/vc-kit/scripts/capture-fixtures.mjs); encodings are never fabricated",
    );
  }
  return encoding;
}
