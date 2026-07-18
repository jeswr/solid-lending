/**
 * The `CredentialSeedPipeline.issue()` seam of
 * docs/research/seeder-design.md section 5.2: ONE call materialises every
 * resource a seeded credential needs (the dual-signed VC, its operand-anchor
 * VCs, and the borrower-only ZK witness), so issuance is never repeated per
 * resource and the outputs stay mutually consistent - `operandEnc` is
 * computed from the SAME claim literal the wrappers emitted, and the Schnorr
 * attestation covers the SAME claim graph the eddsa proof signs.
 *
 * Divergence from the section 5.2 sketch (documented for the app-seeding round): `claims`
 * takes vc-kit's TYPED `CredentialClaims` today - the `GeneratedInstance`
 * adapter arrives with scaffold/the app-seeding round; and the VC serialises as Turtle
 * (vc-kit's issuance format), with the content type carried alongside.
 */

import type {
  BitstringStatusListEntry,
  BitstringStatusListEntryInput,
  KeyPair,
} from "@jeswr/solid-vc";
import type { CredentialClaims } from "../claims.ts";
import type { IssuedCredential, ValidityWindow } from "../issue.ts";
import { issueCredential } from "../issue.ts";
import type { CredentialKind } from "../vocab.ts";
import type { MintedAnchor } from "./anchors.ts";
import { mintOperandAnchors } from "./anchors.ts";
import type { ZkStatusEntry } from "./dual-sign.ts";
import {
  assertZkStatusEntry,
  dualSignCredential,
  fixtureIndexBlindingHex,
  fixtureSaltHex,
} from "./dual-sign.ts";
import type { SparqAttestation, SparqNativeBridge } from "./native.ts";
import { SeedToolingError } from "./native.ts";

/** One credential's seed-time issuance input (seeder-design section 5.2). */
export interface CredentialSeedInput {
  readonly kind: CredentialKind;
  /** The pod resource URL the credential document will live at. */
  readonly credentialId: string;
  readonly subjectWebid: string;
  readonly claims: CredentialClaims;
  /** Explicit validity - the injected clock, never ambient (decision 0012). */
  readonly validFrom: Date;
  readonly validUntil?: Date;
  /** W3C Bitstring status entry for the credential (standards rail). */
  readonly status?: BitstringStatusListEntry | BitstringStatusListEntryInput;
  /** Hidden field IRIs needing operand anchors (decision 0012). */
  readonly hiddenFields?: readonly string[];
  /** Anchor credential IRI per hidden field. */
  readonly anchorIdFor?: (field: string) => string;
  /** Status entry per anchor VC. */
  readonly anchorStatusFor?: (
    field: string,
  ) => BitstringStatusListEntry | BitstringStatusListEntryInput;
  /** The ZK rail's own status entry (required when the credential dual-signs). */
  readonly zkStatus?: ZkStatusEntry;
}

export interface SeededAnchor {
  readonly field: string;
  readonly operandEnc: string;
  /** Serialised anchor VC document (a pod `PUT` body). */
  readonly vc: string;
  readonly contentType: "text/turtle";
  readonly credential: IssuedCredential;
}

export interface CredentialSeedResult {
  /** Serialised credential document (eddsa-rdfc-2022 signed; a pod `PUT` body). */
  readonly vc: string;
  readonly vcContentType: "text/turtle";
  readonly credential: IssuedCredential;
  readonly anchors: readonly SeededAnchor[];
  /**
   * The borrower-only ZK witness resource (JSON): the Schnorr-BJJ dual-sign
   * attestation + the private inputs (salt, clear status index, blinding)
   * future proofs need. ONLY present when the credential participates in ZK
   * flows (`zkStatus` supplied). Store beside the VC, owner-only ACL.
   */
  readonly witness?: string;
  readonly witnessContentType?: "application/json";
}

/** The seam the app-seeding round's layout module consumes (seeder-design section 5.2). */
export interface CredentialSeedPipeline {
  issue(input: CredentialSeedInput): Promise<CredentialSeedResult>;
}

export interface SparqCredentialSeedPipelineOptions {
  /** The issuing party's WebID. */
  readonly issuer: string;
  /** The issuer's eddsa-rdfc-2022 signing key. */
  readonly key: KeyPair;
  /** Deterministic DEMO Schnorr issuer seed (dual-sign rail; not production). */
  readonly schnorrIssuerSeed: number;
  readonly native: SparqNativeBridge;
  /**
   * OPT-IN byte-stable fixtures: derive RDFC salts and index-commitment
   * blindings deterministically from PUBLIC labels instead of OS entropy.
   * NEVER enable outside golden-fixture capture - a public-label blinding
   * lets anyone de-hide the status-index commitment by enumerating the
   * <=1024 candidate indices (roborev 5557 finding 1). Default: entropy.
   */
  readonly deterministicFixtureMode?: boolean;
}

/**
 * Honesty note carried on every witness resource. The full honesty panel
 * (research-grade caveats, assurance status) ships with the Tier-A prover
 * round - docs/zk-plan.md.
 */
export const ZK_WITNESS_HONESTY_NOTE =
  "Research-grade ZK tooling (sparq) - not externally audited; concept demonstration only.";

/** JSON shape of the witness resource (documented for verifiers/tests). */
export interface SeedWitnessDocument {
  readonly type: "urn:sparq:zk:SeedWitness";
  readonly credentialId: string;
  readonly attestation: SparqAttestation;
  readonly witness: {
    readonly saltHex: string;
    readonly zkStatus: ZkStatusEntry;
    readonly indexBlindingHex: string;
  };
  readonly note: string;
}

/**
 * The sparq-backed pipeline: vc-kit issuance (SHACL shape gate before any
 * signature) + native dual-sign + operand anchors.
 */
export class SparqCredentialSeedPipeline implements CredentialSeedPipeline {
  readonly #options: SparqCredentialSeedPipelineOptions;

  constructor(options: SparqCredentialSeedPipelineOptions) {
    // SNAPSHOT FIRST, then validate the snapshot (roborev 5568): reading the
    // caller's object twice would let a getter return a valid seed to the
    // validator and an invalid one to the stored copy. Then fail at
    // CONSTRUCTION, not after a credential has been signed (roborev
    // 5560/5564): an invalid Schnorr seed must never produce partial side
    // effects. Safe-integer bound: a non-safe double (e.g. 1e100) passes
    // Number.isInteger yet fails u64 deserialization in the native helper -
    // AFTER signing.
    const snapshot = Object.freeze({ ...options });
    if (!Number.isSafeInteger(snapshot.schnorrIssuerSeed) || snapshot.schnorrIssuerSeed < 0) {
      throw new SeedToolingError(
        "BAD_ISSUER_SEED",
        "schnorrIssuerSeed must be a non-negative safe integer (deterministic DEMO key seed)",
      );
    }
    this.#options = snapshot;
  }

  async issue(input: CredentialSeedInput): Promise<CredentialSeedResult> {
    const { issuer, key, native } = this.#options;
    // Configuration gates FIRST (roborev 5556): a call that will reject must
    // never sign credentials, mint anchors, or invoke status callbacks.
    const hiddenFields = input.hiddenFields ?? [];
    if (hiddenFields.length > 0) {
      if (input.anchorIdFor === undefined || input.anchorStatusFor === undefined) {
        throw new SeedToolingError(
          "MISSING_ANCHOR_WIRING",
          "hiddenFields need anchorIdFor + anchorStatusFor (anchor IRIs and status entries)",
        );
      }
      if (input.zkStatus === undefined) {
        // A credential with anchors but no dual-sign attestation cannot back
        // a Tier B composite - refuse the half-configured state loudly.
        throw new SeedToolingError(
          "MISSING_ZK_STATUS",
          "hiddenFields were requested without zkStatus - ZK-participating credentials must dual-sign (decision 0004)",
        );
      }
    }
    if (input.zkStatus !== undefined) {
      assertZkStatusEntry(input.zkStatus);
    }
    const validity: ValidityWindow = {
      validFrom: input.validFrom,
      ...(input.validUntil !== undefined ? { validUntil: input.validUntil } : {}),
    };
    const credential = await issueCredential({
      kind: input.kind,
      credentialId: input.credentialId,
      issuer,
      subject: input.subjectWebid,
      claims: input.claims,
      validity,
      ...(input.status !== undefined ? { status: input.status } : {}),
      key,
    });

    let anchors: MintedAnchor[] = [];
    if (
      hiddenFields.length > 0 &&
      input.anchorIdFor !== undefined &&
      input.anchorStatusFor !== undefined
    ) {
      anchors = await mintOperandAnchors({
        credential,
        hiddenFields,
        subject: input.subjectWebid,
        issuer,
        anchorIdFor: input.anchorIdFor,
        statusFor: input.anchorStatusFor,
        validity,
        key,
        native,
      });
    }

    let witness: string | undefined;
    if (input.zkStatus !== undefined) {
      const fixtureMode = this.#options.deterministicFixtureMode === true;
      const dualSigned = await dualSignCredential({
        credential,
        issuerSeed: this.#options.schnorrIssuerSeed,
        zkStatus: input.zkStatus,
        native,
        // Entropy by default; PUBLIC-label derivations only in explicit
        // fixture mode (roborev 5557 finding 1).
        ...(fixtureMode
          ? {
              saltHex: fixtureSaltHex(credential.credentialId),
              indexBlindingHex: fixtureIndexBlindingHex(input.zkStatus),
            }
          : {}),
      });
      const document: SeedWitnessDocument = {
        type: "urn:sparq:zk:SeedWitness",
        credentialId: credential.credentialId,
        attestation: dualSigned.attestation,
        witness: dualSigned.witness,
        note:
          "Borrower-only ZK witness (decision 0012). The clear status index and " +
          `blinding are PRIVATE proof inputs - never publish this resource. ${ZK_WITNESS_HONESTY_NOTE}`,
      };
      witness = `${JSON.stringify(document, null, 2)}\n`;
    }

    return {
      vc: credential.body,
      vcContentType: credential.contentType,
      credential,
      anchors: anchors.map((anchor) => ({
        field: anchor.field,
        operandEnc: anchor.operandEnc,
        vc: anchor.credential.body,
        contentType: anchor.credential.contentType,
        credential: anchor.credential,
      })),
      ...(witness !== undefined
        ? { witness, witnessContentType: "application/json" as const }
        : {}),
    };
  }
}
