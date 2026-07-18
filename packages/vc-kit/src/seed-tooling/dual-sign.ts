/**
 * Seed-time DUAL-SIGNING (decision 0004): a vc-kit
 * credential already carries its `eddsa-rdfc-2022` Data Integrity proof
 * (standards rail); this module adds the ZK rail's Schnorr-over-Baby-JubJub
 * attestation over the Poseidon2 commitment of the SAME claim graph, computed
 * by sparq's native tooling.
 *
 * REPRESENTATION: sparq has no RDF embedding for `poseidon2-schnorr-v1`
 * (its `CommitmentAttestation` is a manifest-layer JSON object, and
 * `sparq-vc` implements eddsa-rdfc-2022 only), so the attestation ships as a
 * JSON WITNESS RESOURCE beside the VC in the pod - borrower-only, per
 * decision 0012 ("witness inputs live borrower-only beside the VC"). The VC
 * document itself is unchanged: no minted proof vocabulary, no hand-built
 * triples.
 */

import type { IssuedCredential } from "../issue.ts";
import type { SparqAttestation, SparqNativeBridge, SparqZkStatusInput } from "./native.ts";
import { SeedToolingError } from "./native.ts";
import { claimGraphToNTriples, deriveFieldHex, randomFieldHex } from "./serialize.ts";

/** The ZK rail's own status-list entry for a credential (decision 0012). */
export interface ZkStatusEntry {
  /** IRI of the Schnorr-bound, <=1024-entry ZK status list. */
  readonly listIri: string;
  /** CLEAR index - borrower-only witness data, never published. */
  readonly index: number;
  readonly version: number;
}

export interface DualSignOptions {
  readonly credential: IssuedCredential;
  /**
   * Deterministic DEMO Schnorr issuer-key seed (sparq `SecretKey::from_seed`,
   * explicitly a test/tooling path - never production key generation).
   */
  readonly issuerSeed: number;
  readonly zkStatus: ZkStatusEntry;
  readonly native: SparqNativeBridge;
  /** Override the per-graph RDFC10 salt (default: fresh OS entropy). */
  readonly saltHex?: string;
  /** Override the index-commitment blinding (default: fresh OS entropy). */
  readonly indexBlindingHex?: string;
}

/** The dual-sign result: the attestation plus the borrower-only witness data. */
export interface DualSignedCredential {
  readonly credentialId: string;
  /** The Schnorr-BJJ attestation (sparq CommitmentAttestation shape). */
  readonly attestation: SparqAttestation;
  /** Private witness data the borrower needs to prove against the attestation. */
  readonly witness: {
    readonly saltHex: string;
    readonly zkStatus: ZkStatusEntry;
    readonly indexBlindingHex: string;
  };
}

/** Bounds of the ZK rail's revoke_unset_d10 status list (decision 0012). */
const ZK_STATUS_MAX_INDEX = 1023;

export function assertZkStatusEntry(status: ZkStatusEntry): void {
  if (
    !Number.isInteger(status.index) ||
    status.index < 0 ||
    status.index > ZK_STATUS_MAX_INDEX ||
    !Number.isInteger(status.version) ||
    status.version < 0 ||
    !/^https?:\/\//.test(status.listIri)
  ) {
    throw new SeedToolingError(
      "BAD_ZK_STATUS",
      `zkStatus must be an http(s) list IRI with integer index 0..${ZK_STATUS_MAX_INDEX} and version >= 0`,
    );
  }
}

/**
 * Deterministic FIXTURE derivations - EXPLICIT OPT-IN ONLY (roborev 5557
 * finding 1): the labels are public, so a blinding derived this way is
 * publicly recomputable and the "hiding" index commitment can be de-hidden
 * by enumerating the <=1024 candidate indices. Used by the capture script
 * (and `deterministicFixtureMode`) for byte-stable fixtures; never the
 * default.
 */
export function fixtureSaltHex(credentialId: string): string {
  return deriveFieldHex(`lending rdfc10 salt: ${credentialId}`);
}
export function fixtureIndexBlindingHex(zkStatus: ZkStatusEntry): string {
  return deriveFieldHex(
    `lending index blinding: ${zkStatus.listIri} ${zkStatus.index} v${zkStatus.version}`,
  );
}

/**
 * Produce the Schnorr-BJJ attestation for an issued credential. The signed
 * message is STATUS-BOUND over the COMMITTED index (sparq sq-ayv discipline):
 * `commitment_message_with_status(C(G), salt, status_ref_commit_digest(...))`
 * - so the hidden-index revocation proof is provably about the exact index
 * the issuer signed, and the salt is issuer-attested.
 */
export async function dualSignCredential(options: DualSignOptions): Promise<DualSignedCredential> {
  const { credential, zkStatus } = options;
  assertZkStatusEntry(zkStatus);
  if (!Number.isInteger(options.issuerSeed) || options.issuerSeed < 0) {
    throw new SeedToolingError("BAD_ISSUER_SEED", "issuerSeed must be a non-negative integer");
  }
  // SECURE BY DEFAULT: fresh OS entropy per call. Deterministic fixture
  // values only ever arrive via the explicit overrides.
  const saltHex = options.saltHex ?? randomFieldHex();
  const indexBlindingHex = options.indexBlindingHex ?? randomFieldHex();
  const name = "credential";
  const result = await options.native.run({
    credentials: [
      {
        name,
        ntriples: claimGraphToNTriples(credential.claimQuads),
        saltHex,
        issuerSeed: options.issuerSeed,
        status: {
          listIri: zkStatus.listIri,
          index: zkStatus.index,
          version: zkStatus.version,
          indexBlindingHex,
        } satisfies SparqZkStatusInput,
      },
    ],
  });
  const attestation = result.attestations[name];
  if (attestation === undefined) {
    throw new SeedToolingError("NO_ATTESTATION", "the native helper returned no attestation");
  }
  return {
    credentialId: credential.credentialId,
    attestation,
    witness: { saltHex, zkStatus, indexBlindingHex },
  };
}
