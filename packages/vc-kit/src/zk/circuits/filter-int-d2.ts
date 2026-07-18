/**
 * PROVENANCE (do not edit by hand): the sparq `zk/compose/filter_int_d2` circuit
 * member, compiled from the sparq read-only checkout at commit
 * 947480b02fcbd174f80f9247b55ee02202d2e345 with the PINNED toolchain
 * `nargo 1.0.0-beta.21` (noirc 1.0.0-beta.21+89a0f0faf3a5f1273c8ac4843b7877882437e277):
 *
 *   nargo compile --package filter_int_d2
 *
 * over an unmodified copy of `zk/compose/{compose_core,filter_int_d2}` — the
 * SAME checkout commit this repo's vc-kit seed-tooling already verified
 * fixtures against (test/fixtures/PROVENANCE.json). Cross-checked two ways at
 * capture time: (1) bytecode is byte-identical to the mortgage showcase's own
 * committed `FilterIntD2` artifact (same relation, same toolchain pin,
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
 * (challenge, operand_enc, op, bound, expected), private digits[2]. The
 * circuit rebuilds the canonical `"<digits>"^^xsd:integer` N-Triples token
 * in-circuit and asserts `h2(LITERAL, blake3(token)) == operand_enc` plus the
 * comparison verdict - a false verdict is UNSATISFIABLE. Re-capture this file
 * (and re-run the suite) on ANY nargo/noir_js/bb.js version bump.
 */
export const FilterIntD2 = {
  noir_version: "1.0.0-beta.21+89a0f0faf3a5f1273c8ac4843b7877882437e277",
  hash: "16308146905184655398",
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
          length: 2,
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
      "4329465905395055483": {
        error_kind: "string",
        string: "non-canonical leading zero",
      },
      "4760072273269455007": {
        error_kind: "string",
        string: "not a decimal digit",
      },
      "14443795209635990948": {
        error_kind: "string",
        string: "operand encoding mismatch",
      },
      "14990209321349310352": {
        error_kind: "string",
        string: "attempt to add with overflow",
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
