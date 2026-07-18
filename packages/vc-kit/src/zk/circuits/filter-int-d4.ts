/**
 * PROVENANCE (do not edit by hand): the sparq `zk/compose/filter_int_d4` circuit
 * member, compiled from the sparq read-only checkout at commit
 * 947480b02fcbd174f80f9247b55ee02202d2e345 with the PINNED toolchain
 * `nargo 1.0.0-beta.21` (noirc 1.0.0-beta.21+89a0f0faf3a5f1273c8ac4843b7877882437e277):
 *
 *   nargo compile --package filter_int_d4
 *
 * over an unmodified copy of `zk/compose/{compose_core,filter_int_d4}` — the
 * SAME checkout commit this repo's vc-kit seed-tooling already verified
 * fixtures against (test/fixtures/PROVENANCE.json). Cross-checked two ways at
 * capture time: (1) bytecode is byte-identical to the mortgage showcase's own
 * committed `FilterIntD4` artifact (same relation, same toolchain pin,
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
 * (challenge, operand_enc, op, bound, expected), private digits[4]. The
 * circuit rebuilds the canonical `"<digits>"^^xsd:integer` N-Triples token
 * in-circuit and asserts `h2(LITERAL, blake3(token)) == operand_enc` plus the
 * comparison verdict - a false verdict is UNSATISFIABLE. Re-capture this file
 * (and re-run the suite) on ANY nargo/noir_js/bb.js version bump.
 */
export const FilterIntD4 = {
  noir_version: "1.0.0-beta.21+89a0f0faf3a5f1273c8ac4843b7877882437e277",
  hash: "3335658993265941789",
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
          length: 4,
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
      "361444214588792908": {
        error_kind: "string",
        string: "attempt to multiply with overflow",
      },
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
