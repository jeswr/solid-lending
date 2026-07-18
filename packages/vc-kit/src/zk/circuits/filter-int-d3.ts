/**
 * PROVENANCE (do not edit by hand): the sparq `zk/compose/filter_int_d3` circuit
 * member, compiled from the sparq read-only checkout at commit
 * 947480b02fcbd174f80f9247b55ee02202d2e345 with the PINNED toolchain
 * `nargo 1.0.0-beta.21` (noirc 1.0.0-beta.21+89a0f0faf3a5f1273c8ac4843b7877882437e277):
 *
 *   nargo compile --package filter_int_d3
 *
 * over an unmodified copy of `zk/compose/{compose_core,filter_int_d3}` — the
 * SAME checkout commit this repo's vc-kit seed-tooling already verified
 * fixtures against (test/fixtures/PROVENANCE.json). Cross-checked two ways at
 * capture time: (1) bytecode is byte-identical to the mortgage showcase's own
 * committed `FilterIntD3` artifact (same relation, same toolchain pin,
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
 * (challenge, operand_enc, op, bound, expected), private digits[3]. The
 * circuit rebuilds the canonical `"<digits>"^^xsd:integer` N-Triples token
 * in-circuit and asserts `h2(LITERAL, blake3(token)) == operand_enc` plus the
 * comparison verdict - a false verdict is UNSATISFIABLE. Re-capture this file
 * (and re-run the suite) on ANY nargo/noir_js/bb.js version bump.
 */
export const FilterIntD3 = {
  noir_version: "1.0.0-beta.21+89a0f0faf3a5f1273c8ac4843b7877882437e277",
  hash: "7277909748492435361",
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
          length: 3,
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
