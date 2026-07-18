/**
 * PROVENANCE (do not edit by hand): the sparq `zk/compose/filter_int_d1` circuit
 * member, compiled from the sparq read-only checkout at commit
 * 947480b02fcbd174f80f9247b55ee02202d2e345 with the PINNED toolchain
 * `nargo 1.0.0-beta.21` (noirc 1.0.0-beta.21+89a0f0faf3a5f1273c8ac4843b7877882437e277):
 *
 *   nargo compile --package filter_int_d1
 *
 * over an unmodified copy of `zk/compose/{compose_core,filter_int_d1}` — the
 * SAME checkout commit this repo's vc-kit seed-tooling already verified
 * fixtures against (test/fixtures/PROVENANCE.json). Cross-checked two ways at
 * capture time: (1) bytecode is byte-identical to the mortgage showcase's own
 * committed `FilterIntD1` artifact (same relation, same toolchain pin,
 * same checkout commit); (2) for `filter_int_d2`, bytecode is byte-identical
 * to the sparq site's own shipped artifact at `site/public/zk/filter_int_d2.json`
 * (the car-hire age-gate circuit).
 *
 * `filter_int_d1` is NOT part of the mortgage vc-kit's committed set — this
 * demo's `NSF₉₀ = 0` predicate needs it: the canonical digit encoding of the
 * value 0 is the single ASCII digit "0" (the circuit forbids a leading zero
 * for D > 1), so a zero-NSF proof only satisfies the 1-digit family member.
 *
 * Only the fields prove/verify consume are committed - `noir_version`, `hash`,
 * `abi`, `bytecode`. The compiler's `debug_symbols` and `file_map` are stripped:
 * they are unused by noir_js/bb.js and would embed absolute build-machine paths.
 *
 * Relation (sparq_zk_compose_core::filter_int): public
 * (challenge, operand_enc, op, bound, expected), private digits[1]. The
 * circuit rebuilds the canonical `"<digits>"^^xsd:integer` N-Triples token
 * in-circuit and asserts `h2(LITERAL, blake3(token)) == operand_enc` plus the
 * comparison verdict - a false verdict is UNSATISFIABLE. Re-capture this file
 * (and re-run the suite) on ANY nargo/noir_js/bb.js version bump.
 */
export const FilterIntD1 = {
  noir_version: "1.0.0-beta.21+89a0f0faf3a5f1273c8ac4843b7877882437e277",
  hash: "16144393180323016391",
  abi: {
    parameters: [
      {
        name: "challenge",
        type: {
          kind: "field",
        },
        visibility: "public",
      },
      {
        name: "operand_enc",
        type: {
          kind: "field",
        },
        visibility: "public",
      },
      {
        name: "op",
        type: {
          kind: "integer",
          sign: "unsigned",
          width: 32,
        },
        visibility: "public",
      },
      {
        name: "bound",
        type: {
          kind: "integer",
          sign: "unsigned",
          width: 64,
        },
        visibility: "public",
      },
      {
        name: "expected",
        type: {
          kind: "boolean",
        },
        visibility: "public",
      },
      {
        name: "digits",
        type: {
          kind: "array",
          length: 1,
          type: {
            kind: "integer",
            sign: "unsigned",
            width: 8,
          },
        },
        visibility: "private",
      },
    ],
    return_type: null,
    error_types: {
      "1998584279744703196": {
        error_kind: "string",
        string: "attempt to subtract with overflow",
      },
      "2689072257712248003": {
        error_kind: "string",
        string: "unknown comparison operator",
      },
      "4760072273269455007": {
        error_kind: "string",
        string: "not a decimal digit",
      },
      "14443795209635990948": {
        error_kind: "string",
        string: "operand encoding mismatch",
      },
      "16338432561539845416": {
        error_kind: "string",
        string: "filter verdict mismatch",
      },
    },
  },
  bytecode:
    "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",
} as const;
