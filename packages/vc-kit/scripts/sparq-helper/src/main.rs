//! sm-26 — seed-time bridge into sparq's native ZK issuance tooling.
//!
//! Reads ONE job document (JSON) from stdin, writes ONE result document
//! (JSON) to stdout. Every cryptographic value is produced by sparq's own
//! crates (`sparq-zk` / `sparq-zk-compose`) — this binary only marshals
//! JSON in and out. Three capabilities:
//!
//! 1. `encodeInts` — `encode_int_literal(v)` term encodings (`operand_enc`
//!    for `"<v>"^^xsd:integer`, decision 0012 operand anchors).
//! 2. `credentials` — Schnorr-over-Baby-JubJub dual-sign attestations over
//!    Poseidon2 graph commitments of RDFC-1.0-canonicalised credential
//!    graphs (decision 0004), status-bound with a HIDING index commitment
//!    (sq-ayv cross-binding, so the hidden-index revocation proof is about
//!    the exact index the issuer signed).
//! 3. `composite` — circuit inputs (public inputs + Prover.toml bodies) for
//!    the decision-0005 Tier B family: same-subject `join_eq`, hidden-index
//!    `revoke_unset_d10`, hidden-issuer-membership `hidden_issuer_d4`.
//!    Proving itself happens in Node (noir_js + bb.js, pinned toolchain,
//!    `verifierTarget: 'evm'`) mirroring sparq's capture-zk-manifest.mjs.
//!
//! HONESTY: the sparq ZK estate is research-grade and NOT externally
//! audited (sparq bead sq-qhy4). Deterministic salts/blinders supplied by
//! the caller are a FIXTURE convenience — production issuance must draw
//! them from OS entropy, and `SecretKey::from_seed` is explicitly a
//! test/tooling key path, never production key generation.

use std::collections::BTreeMap;
use std::io::Read;

use serde::{Deserialize, Serialize};
use sparq_zk::commit::{commit_triples, GraphCommitment};
use sparq_zk::encode::encode_term;
use sparq_zk::field::{field_from_hex_str, field_to_hex};
use sparq_zk::sig::{
    accepted_status_leaf, commitment_message_with_status, in_circuit_witness, key_set_leaf,
    public_key_to_hex, sign_deterministic, signature_from_hex, signature_to_hex,
    status_index_commitment, status_list_id_to_field, status_ref_commit_digest, SecretKey,
    SignatureScheme,
};
use sparq_zk::Fr;
use sparq_zk_compose::build::{build_join, encode_int_literal};
use sparq_zk_compose::toml::{join_prover_toml, pad_rows};
use sparq_zk_compose::{
    hidden_issuer_prover_toml, key_membership_witness, key_set_root, merkle_root, merkle_witness,
    revoke_prover_toml, CircuitId, FieldHex, HiddenIssuerWitness, ProofInputs,
    StatusListSnapshot,
};

// ── job (stdin) ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Job {
    /// xsd:integer values to encode (`operand_enc` per hidden field).
    #[serde(default)]
    encode_ints: Vec<u64>,
    /// Credential graphs to commit + Schnorr-attest (dual-sign).
    #[serde(default)]
    credentials: Vec<CredentialJob>,
    /// Tier B composite circuit-input build (references `credentials` by name).
    #[serde(default)]
    composite: Option<CompositeJob>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CredentialJob {
    /// Caller handle (referenced by `composite`).
    name: String,
    /// The SIGNED credential subset (claim graph, NO eddsa proof) as N-Triples.
    ntriples: String,
    /// Per-graph RDFC10 bnode salt (`zk:rdfc10Salt`), 0x field hex.
    salt_hex: String,
    /// Deterministic demo issuer key seed (`SecretKey::from_seed` — NOT production).
    issuer_seed: u64,
    /// The ZK rail's own Schnorr-bound status list entry (decision 0012).
    status: StatusJob,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StatusJob {
    list_iri: String,
    index: u64,
    version: u64,
    /// Blinding for the HIDING index commitment (0x field hex).
    index_blinding_hex: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CompositeJob {
    /// The capture-time challenge as a field element (0x hex) — Node derives
    /// it from the nonce string exactly like vc-kit's `challengeFieldOf`.
    challenge_hex: String,
    join: JoinJob,
    revoke: RevokeJob,
    hidden_issuer: HiddenIssuerJob,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JoinJob {
    /// `credentials[].name` of graph A / graph B.
    a: String,
    b: String,
    /// Join slots in {0,1,2} (s/p/o); same-subject join = 0/0.
    slot_a: u32,
    slot_b: u32,
    /// Per-presentation blinder for the hiding join commitment (0x hex).
    blinding_hex: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevokeJob {
    /// Which credential's status entry the proof is about.
    credential: String,
    /// Merkle depth (10 => `revoke_unset_d10`, 1024 indices).
    depth: u32,
    /// Status list size in bits.
    size: u64,
    /// Indices whose status bit is SET (revoked) in the snapshot.
    #[serde(default)]
    revoked_indices: Vec<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HiddenIssuerJob {
    /// The trusted issuer key-set, as deterministic demo seeds (order = leaves).
    issuer_seeds: Vec<u64>,
    /// Which credential's attestation the membership proof is about.
    credential: String,
    /// Key-set Merkle depth (4 => `hidden_issuer_d4`, ≤16 keys).
    depth: u32,
}

// ── result (stdout) ────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output {
    /// value (decimal string) -> operand_enc (0x hex).
    encodings: BTreeMap<String, String>,
    /// credential name -> dual-sign attestation.
    attestations: BTreeMap<String, Attestation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    composite: Option<CompositeOut>,
}

/// The Schnorr-BJJ dual-sign attestation — field names mirror sparq's
/// `sparq_zk_compose::manifest::CommitmentAttestation` (serde JSON shape) with
/// the extra seed-tooling context (`message`, `status.listIri`) appended.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Attestation {
    /// Poseidon2 commitment `C(G)` over the RDFC-1.0 canonical claim graph.
    commitment: String,
    /// The per-graph salt (issuer-attested: the signed message binds it).
    salt: String,
    /// Compressed Baby-JubJub issuer verification key, hex.
    issuer_public_key: String,
    /// Schnorr signature over `commitment_message_with_status(C, salt, ref)`.
    signature: String,
    /// `zk:cryptosuite` IRI — `poseidon2-schnorr-v1`.
    cryptosuite: String,
    /// The exact signed message field (input `m` of `hidden_issuer_d4`).
    message: String,
    /// Canonical claim-graph triple count (join bucket sizing / diagnostics).
    canonical_triples: usize,
    status: AttestationStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AttestationStatus {
    list_iri: String,
    version: u64,
    /// HIDING commitment to the status index (the CLEAR index is never output
    /// here — sq-ayv committed-index discipline).
    index_commitment: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompositeOut {
    challenge: String,
    join: SubRelation,
    revoke: SubRelation,
    hidden_issuer: SubRelation,
    /// Verifier-side trust anchors for documentation/PROVENANCE.
    context: CompositeContext,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SubRelation {
    /// Compiled circuit member (`CircuitId::package()` naming).
    member: String,
    /// Public inputs by ABI name, in declaration order.
    public_inputs: Vec<(String, String)>,
    /// Full Prover.toml body (public + private witness) for noir_js execution.
    prover_toml: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompositeContext {
    status_list: StatusListContext,
    issuer_key_set_root: String,
    /// Compressed issuer public keys, leaf order.
    issuer_key_set: Vec<String>,
    join_relation: String,
}

/// The ISSUER-AUTHENTICATED status-list snapshot reference (decision 0012's
/// "Schnorr-bound" ZK status list): the list issuer signs the sparq
/// `accepted_status_leaf(H(list_iri), version, root)` digest, so a verifier
/// holding the issuer key can authenticate the exact (list, version, root)
/// the revocation proof was built against — a prover cannot substitute an
/// all-unset snapshot of their own making.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusListContext {
    iri: String,
    version: u64,
    root: String,
    /// Schnorr-BJJ signature over `accepted_status_leaf(H(iri), version, root)`.
    root_signature: String,
    /// The signing (list-issuer) verification key, compressed hex.
    issuer_public_key: String,
    cryptosuite: String,
}

// ── helpers ────────────────────────────────────────────────────────────────────

fn fail(msg: &str) -> ! {
    eprintln!("[sparq-seed-helper] {msg}");
    std::process::exit(1);
}

fn field(hex: &str, label: &str) -> Fr {
    match field_from_hex_str(hex.strip_prefix("0x").unwrap_or(hex)) {
        Some(f) => f,
        None => fail(&format!("{label} is not valid field hex: {hex}")),
    }
}

fn parse_ntriples(doc: &str, label: &str) -> Vec<oxrdf::Triple> {
    let mut triples = Vec::new();
    for result in oxttl::NTriplesParser::new().for_slice(doc.as_bytes()) {
        match result {
            Ok(triple) => triples.push(triple),
            Err(e) => fail(&format!("{label}: N-Triples parse error: {e}")),
        }
    }
    if triples.is_empty() {
        fail(&format!("{label}: empty credential graph"));
    }
    triples
}

fn commit_credential(job: &CredentialJob) -> (GraphCommitment, Fr) {
    let triples = parse_ntriples(&job.ntriples, &job.name);
    let salt = field(&job.salt_hex, &format!("{} saltHex", job.name));
    match commit_triples(&triples, salt) {
        Ok(commitment) => (commitment, salt),
        Err(e) => fail(&format!("{}: commit failed: {e}", job.name)),
    }
}

fn attest(job: &CredentialJob, commitment: &GraphCommitment, salt: Fr) -> (Attestation, Fr) {
    let blinding = field(
        &job.status.index_blinding_hex,
        &format!("{} status.indexBlindingHex", job.name),
    );
    let index_commitment = status_index_commitment(job.status.index, &blinding);
    let list_id = status_list_id_to_field(&job.status.list_iri);
    // Committed-index status binding (sq-ayv): the issuer signs the HIDING
    // index commitment, so the revocation proof's index_commitment public
    // input is byte-matched to an issuer-signed value.
    let status_ref = status_ref_commit_digest(&list_id, &index_commitment, job.status.version);
    let sk = SecretKey::from_seed(job.issuer_seed);
    let signature = sk.sign_commitment_with_status(&commitment.commitment, &salt, &status_ref);
    let message = commitment_message_with_status(&commitment.commitment, &salt, &status_ref);
    (
        Attestation {
            commitment: field_to_hex(&commitment.commitment),
            salt: field_to_hex(&salt),
            issuer_public_key: public_key_to_hex(&sk.public_key()),
            signature,
            cryptosuite: SignatureScheme::Poseidon2SchnorrV1.cryptosuite_iri().to_string(),
            message: field_to_hex(&message),
            canonical_triples: commitment.canonical.triples.len(),
            status: AttestationStatus {
                list_iri: job.status.list_iri.clone(),
                version: job.status.version,
                index_commitment: field_to_hex(&index_commitment),
            },
        },
        message,
    )
}

fn join_bucket(id: &CircuitId) -> (u32, u32) {
    match id {
        CircuitId::JoinEq { n_a, n_b } => (*n_a, *n_b),
        other => fail(&format!("unexpected join circuit id: {other:?}")),
    }
}

fn build_join_relation(
    job: &JoinJob,
    challenge: &FieldHex,
    a: &GraphCommitment,
    b: &GraphCommitment,
) -> SubRelation {
    let blinding = field(&job.blinding_hex, "join.blindingHex");
    let built = match build_join(a, job.slot_a, b, job.slot_b, blinding) {
        Some(built) => built,
        None => fail("join: no shared value at the chosen slots, or graph size out of family"),
    };
    let (id, commit_a, commit_b, join_commitment, slot_a, slot_b) = match &built.inputs {
        ProofInputs::JoinEq { id, commit_a, commit_b, join_commitment, slot_a, slot_b } => {
            (id, commit_a.clone(), commit_b.clone(), join_commitment.clone(), *slot_a, *slot_b)
        }
        other => fail(&format!("unexpected join proof inputs: {other:?}")),
    };
    let (n_a, n_b) = join_bucket(id);
    let witness = &built.witness;
    let enc_a = pad_rows(witness.enc_a.clone(), n_a as usize);
    let enc_b = pad_rows(witness.enc_b.clone(), n_b as usize);
    let prover_toml = join_prover_toml(
        challenge,
        &commit_a,
        &commit_b,
        &join_commitment,
        slot_a,
        slot_b,
        &enc_a,
        witness.counts_a,
        &enc_b,
        witness.counts_b,
        &witness.row_a,
        &witness.row_b,
        &witness.blinding,
    );
    SubRelation {
        member: id.package(),
        public_inputs: vec![
            ("challenge".into(), challenge.0.clone()),
            ("commit_a".into(), commit_a.0),
            ("commit_b".into(), commit_b.0),
            ("join_commitment".into(), join_commitment.0),
            ("slot_a".into(), slot_a.to_string()),
            ("slot_b".into(), slot_b.to_string()),
        ],
        prover_toml,
    }
}

fn build_revoke_relation(
    job: &RevokeJob,
    challenge_fr: &Fr,
    credential: &CredentialJob,
) -> (SubRelation, Fr) {
    if job.size == 0 || job.size % 8 != 0 || job.size > (1u64 << job.depth) {
        fail("revoke: size must be a positive multiple of 8 within 2^depth");
    }
    let mut bits = vec![0u8; (job.size / 8) as usize];
    for index in &job.revoked_indices {
        if *index >= job.size {
            fail(&format!("revoke: revoked index {index} out of range"));
        }
        bits[(*index / 8) as usize] |= 1 << (*index % 8);
    }
    let snapshot = StatusListSnapshot {
        status_list: credential.status.list_iri.clone(),
        version: credential.status.version,
        bits,
    };
    let root = match merkle_root(&snapshot, job.depth) {
        Some(root) => root,
        None => fail("revoke: could not build the status-list Merkle root"),
    };
    let index = credential.status.index;
    let witness = match merkle_witness(&snapshot, job.depth, index) {
        Some(witness) => witness,
        None => fail("revoke: could not build the Merkle witness"),
    };
    let blinding = field(
        &credential.status.index_blinding_hex,
        "revoke credential status.indexBlindingHex",
    );
    let index_commitment = status_index_commitment(index, &blinding);
    let prover_toml =
        revoke_prover_toml(challenge_fr, &root, &index_commitment, index, &blinding, &witness);
    (
        SubRelation {
            member: format!("revoke_unset_d{}", job.depth),
            public_inputs: vec![
                ("challenge".into(), field_to_hex(challenge_fr)),
                ("root".into(), field_to_hex(&root)),
                ("index_commitment".into(), field_to_hex(&index_commitment)),
            ],
            prover_toml,
        },
        root,
    )
}

fn build_hidden_issuer_relation(
    job: &HiddenIssuerJob,
    challenge_fr: &Fr,
    credential: &CredentialJob,
    attestation: &Attestation,
    message: &Fr,
) -> (SubRelation, Fr, Vec<String>) {
    if job.issuer_seeds.is_empty() || job.issuer_seeds.len() > (1usize << job.depth) {
        fail("hiddenIssuer: issuerSeeds must be non-empty and fit 2^depth");
    }
    let keys: Vec<_> = job
        .issuer_seeds
        .iter()
        .map(|seed| SecretKey::from_seed(*seed).public_key())
        .collect();
    for key in &keys {
        if key_set_leaf(key).is_none() {
            fail("hiddenIssuer: an issuer key has no key-set leaf");
        }
    }
    let index = match job.issuer_seeds.iter().position(|s| *s == credential.issuer_seed) {
        Some(index) => index as u64,
        None => fail("hiddenIssuer: the credential's issuer seed is not in issuerSeeds"),
    };
    let root = match key_set_root(&keys, job.depth) {
        Some(root) => root,
        None => fail("hiddenIssuer: could not build the key-set root"),
    };
    let siblings = match key_membership_witness(&keys, job.depth, index) {
        Some(siblings) => siblings,
        None => fail("hiddenIssuer: could not build the membership witness"),
    };
    let signature = match signature_from_hex(&attestation.signature) {
        Some(signature) => signature,
        None => fail("hiddenIssuer: attestation signature hex did not parse"),
    };
    let sk = SecretKey::from_seed(credential.issuer_seed);
    let schnorr = match in_circuit_witness(&sk.public_key(), message, &signature) {
        Some(witness) => witness,
        None => fail("hiddenIssuer: in-circuit Schnorr witness build failed"),
    };
    let witness = HiddenIssuerWitness { schnorr, index, siblings };
    let prover_toml = hidden_issuer_prover_toml(challenge_fr, message, &root, &witness);
    let key_hexes = keys.iter().map(public_key_to_hex).collect();
    (
        SubRelation {
            member: format!("hidden_issuer_d{}", job.depth),
            public_inputs: vec![
                ("challenge".into(), field_to_hex(challenge_fr)),
                ("m".into(), field_to_hex(message)),
                ("key_set_root".into(), field_to_hex(&root)),
            ],
            prover_toml,
        },
        root,
        key_hexes,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use sparq_zk::sig::verify;

    /// The status-root attestation is a REAL signature a verifier can check
    /// against a trust-store key - and it rejects every substitution
    /// (roborev 5560 finding 2: no self-authentication; the key must come
    /// from the verifier's own registry, not the manifest).
    #[test]
    fn status_root_signature_verifies_and_rejects_substitutions() {
        let sk = SecretKey::from_seed(4101);
        let other_sk = SecretKey::from_seed(4202);
        let iri = "https://issuer.example/status/zk-employment";
        let root = field("0x2a", "root");
        let version = 1;

        let list_id = status_list_id_to_field(iri);
        let digest = accepted_status_leaf(&list_id, version, &root);
        let signature = sign_deterministic(&sk, &digest);

        // Genuine (key from the verifier's trust store) - verifies.
        assert!(verify(&sk.public_key(), &digest, &signature));

        // A DIFFERENT trusted key does not authenticate this signature - a
        // prover shipping their own key alongside their own signature gains
        // nothing once the verifier pins keys independently.
        assert!(!verify(&other_sk.public_key(), &digest, &signature));

        // Substituted root / version / list IRI all change the signed digest.
        let wrong_root = accepted_status_leaf(&list_id, version, &field("0x2b", "root"));
        assert!(!verify(&sk.public_key(), &wrong_root, &signature));
        let wrong_version = accepted_status_leaf(&list_id, 2, &root);
        assert!(!verify(&sk.public_key(), &wrong_version, &signature));
        let wrong_list =
            status_list_id_to_field("https://mallory.example/status/zk-employment");
        let wrong_iri = accepted_status_leaf(&wrong_list, version, &root);
        assert!(!verify(&sk.public_key(), &wrong_iri, &signature));

        // And the hex round-trip used in the JSON output stays verifiable.
        let rehydrated = signature_from_hex(&signature_to_hex(&signature))
            .expect("signature hex round-trips");
        assert!(verify(&sk.public_key(), &digest, &rehydrated));
    }
}

fn main() {
    let mut raw = String::new();
    if std::io::stdin().read_to_string(&mut raw).is_err() {
        fail("could not read the job document from stdin");
    }
    let job: Job = match serde_json::from_str(&raw) {
        Ok(job) => job,
        Err(e) => fail(&format!("job document is not valid JSON: {e}")),
    };

    // 1. operand_enc term encodings.
    let mut encodings = BTreeMap::new();
    for value in &job.encode_ints {
        let enc = encode_int_literal(*value);
        encodings.insert(value.to_string(), enc.0);
    }
    // Cross-check: the salt-independence contract encode_int_literal relies on.
    if let Some(value) = job.encode_ints.first() {
        let lit = oxrdf::Literal::new_typed_literal(
            value.to_string(),
            oxrdf::NamedNode::new("http://www.w3.org/2001/XMLSchema#integer")
                .expect("static IRI"),
        );
        let direct = encode_term(&oxrdf::Term::Literal(lit), &Fr::from(7u64))
            .map(|f| field_to_hex(&f));
        if direct.as_deref() != encodings.get(&value.to_string()).map(String::as_str) {
            fail("encode_int_literal no longer salt-independent — sparq contract change");
        }
    }

    // 2. Dual-sign attestations.
    let mut commitments: BTreeMap<String, (GraphCommitment, Fr)> = BTreeMap::new();
    let mut attestations = BTreeMap::new();
    let mut messages: BTreeMap<String, Fr> = BTreeMap::new();
    for credential in &job.credentials {
        if commitments.contains_key(&credential.name) {
            fail(&format!("duplicate credential name {}", credential.name));
        }
        let (commitment, salt) = commit_credential(credential);
        let (attestation, message) = attest(credential, &commitment, salt);
        attestations.insert(credential.name.clone(), attestation);
        messages.insert(credential.name.clone(), message);
        commitments.insert(credential.name.clone(), (commitment, salt));
    }

    // 3. Composite circuit inputs.
    let composite = job.composite.as_ref().map(|composite| {
        let credential_job = |name: &str| -> &CredentialJob {
            match job.credentials.iter().find(|c| c.name == name) {
                Some(c) => c,
                None => fail(&format!("composite references unknown credential {name}")),
            }
        };
        let challenge_fr = field(&composite.challenge_hex, "composite.challengeHex");
        let challenge = FieldHex(field_to_hex(&challenge_fr));

        let committed = |name: &str| -> &(GraphCommitment, Fr) {
            match commitments.get(name) {
                Some(entry) => entry,
                None => fail(&format!("composite references unknown credential {name}")),
            }
        };
        let (a, _) = committed(&composite.join.a);
        let (b, _) = committed(&composite.join.b);
        let join = build_join_relation(&composite.join, &challenge, a, b);

        let revoke_credential = credential_job(&composite.revoke.credential);
        let (revoke, status_root) =
            build_revoke_relation(&composite.revoke, &challenge_fr, revoke_credential);
        // Issuer-authenticate the snapshot root (decision 0012 "Schnorr-bound"
        // list): sign the sparq accepted-status-leaf digest for (list, version,
        // root) with the LIST ISSUER's key, so a verifier can reject a
        // prover-minted all-unset snapshot (roborev 5554 finding 2).
        let list_sk = SecretKey::from_seed(revoke_credential.issuer_seed);
        let list_id = status_list_id_to_field(&revoke_credential.status.list_iri);
        let accepted =
            accepted_status_leaf(&list_id, revoke_credential.status.version, &status_root);
        let status_list = StatusListContext {
            iri: revoke_credential.status.list_iri.clone(),
            version: revoke_credential.status.version,
            root: field_to_hex(&status_root),
            root_signature: signature_to_hex(&sign_deterministic(&list_sk, &accepted)),
            issuer_public_key: public_key_to_hex(&list_sk.public_key()),
            cryptosuite: SignatureScheme::Poseidon2SchnorrV1.cryptosuite_iri().to_string(),
        };

        let issuer_credential = credential_job(&composite.hidden_issuer.credential);
        let attestation = &attestations[&issuer_credential.name];
        let message = &messages[&issuer_credential.name];
        let (hidden_issuer, key_root, key_set) = build_hidden_issuer_relation(
            &composite.hidden_issuer,
            &challenge_fr,
            issuer_credential,
            attestation,
            message,
        );

        CompositeOut {
            challenge: challenge.0.clone(),
            join,
            revoke,
            hidden_issuer,
            context: CompositeContext {
                status_list,
                issuer_key_set_root: field_to_hex(&key_root),
                issuer_key_set: key_set,
                join_relation:
                    "hidden same-subject equality across the two committed credential graphs"
                        .to_string(),
            },
        }
    });

    let output = Output { encodings, attestations, composite };
    match serde_json::to_string_pretty(&output) {
        Ok(body) => println!("{body}"),
        Err(e) => fail(&format!("could not serialise the result: {e}")),
    }
}
