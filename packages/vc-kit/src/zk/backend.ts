/**
 * Shared UltraHonk backend plumbing for Tier A (docs/zk-plan.md; decisions
 * 0005/0012 postures carried over from the mortgage showcase, design §6.5):
 * lazy pinned-toolchain loading (`@noir-lang/noir_js@1.0.0-beta.21` +
 * `@aztec/bb.js@5.0.0-nightly.20260324`), the single sanctioned proof
 * flavour, prewarm, challenge->field derivation and constant-time field
 * comparison.
 *
 * SECURITY - the proof flavour is a constant, not a parameter:
 * `verifierTarget: 'evm'` (keccak transcript oracle, ~8.4 kB proofs) keeps
 * `disableZk` at its default `false`, so proofs remain FULLY zero-knowledge.
 * The `*-no-zk` flavours strip the ZK masking (the hidden value becomes
 * recoverable in principle); nothing in this package can be configured into
 * one - {@link assertZkVerifierTarget} rejects them by name and by suffix.
 *
 * bb.js multithreading is gated on cross-origin isolation
 * (SharedArrayBuffer -> COOP + COEP response headers). Apps that mount the
 * Tier A prover MUST set `Cross-Origin-Opener-Policy: same-origin` and
 * `Cross-Origin-Embedder-Policy: require-corp` (Next.js `headers()` in
 * next.config) for the ~4x multithread win; without them proving still works,
 * single-threaded.
 */

import type { CompiledCircuitArtifact, FilterIntMember } from "./circuits/registry.ts";
import { loadCommittedCircuit } from "./circuits/registry.ts";

/** A produced/consumed UltraHonk proof: opaque bytes + ordered public inputs. */
export interface ProofData {
  readonly proof: Uint8Array;
  /** 32-byte 0x-hex field elements, in the circuit's public-input ABI order. */
  readonly publicInputs: readonly string[];
}

/**
 * The ONLY sanctioned proof flavour (decision 0005 posture). `as const` + the
 * type-level exclusion below keep a `*-no-zk` value unrepresentable here.
 */
export const ZK_VERIFIER_TARGET = "evm" as const;
export type ZkVerifierTarget = typeof ZK_VERIFIER_TARGET;

const PROOF_OPTIONS = Object.freeze({ verifierTarget: ZK_VERIFIER_TARGET });

/** Thrown for every Tier A configuration or verification-input failure. */
export class ZkError extends Error {
  override readonly name: string = "ZkError";
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Fail-closed flavour gate for values arriving over the wire (a presented
 * proof descriptor names the flavour it claims). ONLY the exact string
 * `"evm"` passes; anything else - and, belt-and-braces, anything containing
 * `no-zk` - is rejected before bb.js is ever consulted.
 */
export function assertZkVerifierTarget(value: unknown): asserts value is ZkVerifierTarget {
  if (typeof value !== "string" || value.includes("no-zk") || value !== ZK_VERIFIER_TARGET) {
    throw new ZkError(
      "FORBIDDEN_FLAVOUR",
      `verifierTarget ${JSON.stringify(value)} is not the sanctioned full-ZK "${ZK_VERIFIER_TARGET}" flavour`,
    );
  }
}

// ── lazy pinned-toolchain backend, one per circuit member ──────────────────────────

interface NoirProgram {
  execute(inputs: Record<string, unknown>): Promise<{ witness: Uint8Array }>;
}

interface UltraHonkLike {
  generateProof(
    witness: Uint8Array,
    options?: { verifierTarget?: string },
  ): Promise<{ proof: Uint8Array; publicInputs: string[] }>;
  verifyProof(
    proof: { proof: Uint8Array; publicInputs: string[] },
    options?: { verifierTarget?: string },
  ): Promise<boolean>;
}

interface MemberBackend {
  readonly circuit: CompiledCircuitArtifact;
  readonly noir: NoirProgram;
  readonly backend: UltraHonkLike;
  readonly threads: number;
}

/** bb.js threads: cross-origin-isolated browsers get up to 8; Node/plain get 1. */
function maxThreads(): number {
  const scope = globalThis as { crossOriginIsolated?: boolean; navigator?: Navigator };
  if (scope.crossOriginIsolated !== true) return 1;
  return Math.min(scope.navigator?.hardwareConcurrency ?? 1, 8);
}

/** One shared WASM API instance (the dominant cold cost), then one backend per member. */
let apiPromise: Promise<{ api: unknown; threads: number }> | null = null;
const memberBackends = new Map<FilterIntMember, Promise<MemberBackend>>();

async function loadApi(): Promise<{ api: unknown; threads: number }> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const bb = await import("@aztec/bb.js");
      const threads = maxThreads();
      const api = await bb.Barretenberg.new({ threads });
      return { api, threads };
    })();
    apiPromise.catch(() => {
      apiPromise = null; // transient load failures may retry
    });
  }
  return apiPromise;
}

/** Load (once) the pinned toolchain + committed artifact + backend for `member`. */
export async function memberBackend(member: FilterIntMember): Promise<MemberBackend> {
  let pending = memberBackends.get(member);
  if (!pending) {
    pending = (async () => {
      const [{ Noir }, bb, circuit, { api, threads }] = await Promise.all([
        import("@noir-lang/noir_js"),
        import("@aztec/bb.js"),
        loadCommittedCircuit(member),
        loadApi(),
      ]);
      // The committed artifact IS a noir_js CompiledCircuit (identical compiler
      // pin - registry asserts it); the casts bridge our structural artifact
      // type to the libraries' own richer parameter types.
      const noir = new Noir(
        circuit as unknown as ConstructorParameters<typeof Noir>[0],
      ) as unknown as NoirProgram;
      const backend = new bb.UltraHonkBackend(
        circuit.bytecode,
        api as ConstructorParameters<typeof bb.UltraHonkBackend>[1],
      ) as UltraHonkLike;
      return { circuit, noir, backend, threads };
    })();
    memberBackends.set(member, pending);
    pending.catch(() => {
      memberBackends.delete(member);
    });
  }
  return pending;
}

/**
 * Eagerly pay the cold start (dynamic imports + WASM instantiate + artifact
 * load) so the first prove/verify click doesn't. Call on ZK-route mount; safe
 * to call repeatedly (promises are shared). UX only - changes no security
 * property.
 */
export function prewarm(
  members: readonly FilterIntMember[] = ["filter_int_d1", "filter_int_d3", "filter_int_d4"],
): Promise<unknown> {
  return Promise.all(members.map((member) => memberBackend(member)));
}

/** Prove with the pinned flavour. Callers never pass options - see module header. */
export async function generateProof(
  member: FilterIntMember,
  witness: Uint8Array,
): Promise<ProofData> {
  const { backend } = await memberBackend(member);
  return backend.generateProof(witness, PROOF_OPTIONS);
}

/** Verify with the pinned flavour against the COMMITTED artifact for `member`. */
export async function verifyProof(member: FilterIntMember, proof: ProofData): Promise<boolean> {
  const { backend } = await memberBackend(member);
  return backend.verifyProof(
    { proof: proof.proof, publicInputs: [...proof.publicInputs] },
    PROOF_OPTIONS,
  );
}

// ── challenge + field-element helpers ──────────────────────────────────────────────

const FIELD_HEX = /^0x[0-9a-fA-F]{1,64}$/;

/**
 * Normalise a field-element hex string to its canonical 64-digit lowercase
 * form (bb.js public inputs are 32-byte-padded; anchor VCs store minimal
 * lowercase hex). Throws on anything that is not field-shaped hex.
 */
export function normalizeFieldHex(value: string, label: string): string {
  if (!FIELD_HEX.test(value)) {
    throw new ZkError("MALFORMED_FIELD", `${label} is not 0x-prefixed field hex`);
  }
  return `0x${value.slice(2).toLowerCase().padStart(64, "0")}`;
}

/**
 * Constant-time equality of two field-element hex strings (normalised first,
 * so textual variance never shortcuts). Anything non-field-shaped compares
 * unequal rather than throwing - callers treat `false` as the rejection.
 */
export function fieldHexEquals(a: string, b: string, label: string): boolean {
  let left: string;
  let right: string;
  try {
    left = normalizeFieldHex(a, label);
    right = normalizeFieldHex(b, label);
  } catch {
    return false;
  }
  // Both sides are now exactly 66 chars; XOR-accumulate, no early exit.
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * Deterministically derive the circuit's `challenge` public input from a
 * transport nonce (a verifier-minted nonce string is not necessarily a valid
 * BN254 field element): SHA-256(nonce), first 31 bytes, as 0x-hex - always
 * < 2^248 < the BN254 modulus. Prover and verifier derive independently from
 * the same nonce string, so a proof only verifies against the exact nonce it
 * was produced for (the challenge is baked into the UltraHonk transcript).
 */
export async function challengeFieldOf(nonce: string): Promise<string> {
  if (typeof nonce !== "string" || nonce.length === 0) {
    throw new ZkError("MALFORMED_NONCE", "challenge nonce must be a non-empty string");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
  const bytes = new Uint8Array(digest).slice(0, 31);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return normalizeFieldHex(`0x${hex}`, "derived challenge");
}
