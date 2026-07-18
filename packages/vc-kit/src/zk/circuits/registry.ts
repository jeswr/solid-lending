/**
 * The COMMITTED circuit registry (docs/zk-plan.md; decision 0005/0012
 * postures carried over from the mortgage showcase). Tier A proofs verify
 * ONLY against circuit artifacts committed in this package - never against
 * caller- or network-supplied bytecode: the verification key is derived from
 * the artifact, so accepting foreign bytecode would let a presenter choose
 * the very circuit their proof is checked against.
 *
 * Artifacts are lazy-loaded via dynamic import so the ~35 kB circuit modules
 * stay out of bundles until a prove/verify actually happens.
 *
 * This registry commits FOUR members - `filter_int_d1..d4` - one more than
 * the mortgage showcase's three. This demo's `lend:nsf90Count = 0` predicate
 * needs the 1-digit member: the canonical digit encoding of the value 0 is
 * the single ASCII digit "0" (the circuit forbids a leading zero for D > 1),
 * so a genuine zero-NSF proof is only satisfiable against `filter_int_d1`.
 */

/** The compiled-circuit artifact surface this package consumes. */
export interface CompiledCircuitArtifact {
  /** `nargo --version` string baked into the artifact at compile time. */
  readonly noir_version: string;
  /** Base64 ACIR bytecode - the input `UltraHonkBackend` derives the VK from. */
  readonly bytecode: string;
  /** The ABI (parameter names/types/visibility) noir_js encodes inputs with. */
  readonly abi: unknown;
}

/** The pinned toolchain (docs/zk-plan.md; mirrors the mortgage showcase's decision 0005 pin). */
export const PINNED_NARGO_VERSION = "1.0.0-beta.21";
export const PINNED_NOIR_JS_VERSION = "1.0.0-beta.21";
export const PINNED_BB_JS_VERSION = "5.0.0-nightly.20260324";

/** The Tier A filter members this package commits. */
export type FilterIntMember = "filter_int_d1" | "filter_int_d2" | "filter_int_d3" | "filter_int_d4";

interface MemberEntry {
  readonly digits: 1 | 2 | 3 | 4;
  readonly load: () => Promise<CompiledCircuitArtifact>;
}

const MEMBERS: Readonly<Record<FilterIntMember, MemberEntry>> = {
  filter_int_d1: {
    digits: 1,
    load: async () => (await import("./filter-int-d1.ts")).FilterIntD1,
  },
  filter_int_d2: {
    digits: 2,
    load: async () => (await import("./filter-int-d2.ts")).FilterIntD2,
  },
  filter_int_d3: {
    digits: 3,
    load: async () => (await import("./filter-int-d3.ts")).FilterIntD3,
  },
  filter_int_d4: {
    digits: 4,
    load: async () => (await import("./filter-int-d4.ts")).FilterIntD4,
  },
};

/** The committed member names, in digit order. */
export const COMMITTED_MEMBERS: readonly FilterIntMember[] = [
  "filter_int_d1",
  "filter_int_d2",
  "filter_int_d3",
  "filter_int_d4",
];

/**
 * Strict committed-membership check: the EXACT member name or nothing.
 * Anything else - unknown members, `*-no-zk` spellings, path tricks - maps to
 * `undefined` and the caller fails closed.
 */
export function asCommittedMember(name: string): FilterIntMember | undefined {
  return Object.hasOwn(MEMBERS, name) ? (name as FilterIntMember) : undefined;
}

/** Decimal-digit count of a committed member's private witness. */
export function memberDigits(member: FilterIntMember): 1 | 2 | 3 | 4 {
  return MEMBERS[member].digits;
}

/** The committed member whose digit width is exactly `digits`, if any. */
export function memberForDigits(digits: number): FilterIntMember | undefined {
  return COMMITTED_MEMBERS.find((member) => MEMBERS[member].digits === digits);
}

/**
 * Load a committed circuit artifact, asserting the compile-time toolchain pin
 * (an artifact regenerated with a different nargo would silently change the
 * verification key - the pin covers the whole chain).
 */
export async function loadCommittedCircuit(
  member: FilterIntMember,
): Promise<CompiledCircuitArtifact> {
  const artifact = await MEMBERS[member].load();
  assertCircuitArtifact(artifact, member);
  return artifact;
}

/**
 * Structural + toolchain-pin gate for a circuit artifact. Throws on anything
 * malformed.
 */
export function assertCircuitArtifact(
  artifact: CompiledCircuitArtifact,
  label: string,
): asserts artifact is CompiledCircuitArtifact {
  if (typeof artifact !== "object" || artifact === null) {
    throw new Error(`circuit artifact ${label} is not an object`);
  }
  if (typeof artifact.bytecode !== "string" || artifact.bytecode.length === 0) {
    throw new Error(`circuit artifact ${label} has no bytecode`);
  }
  if (
    typeof artifact.noir_version !== "string" ||
    !artifact.noir_version.startsWith(PINNED_NARGO_VERSION)
  ) {
    throw new Error(
      `circuit artifact ${label} was compiled with "${String(
        (artifact as { noir_version?: unknown }).noir_version,
      )}" - expected the pinned nargo ${PINNED_NARGO_VERSION}`,
    );
  }
}
