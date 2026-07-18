/**
 * IRI constants for the vc-kit credential graphs. Every namespace is a real,
 * dereferenceable vocabulary (W3C cred/sec/status, schema.org, FIBO, DCMI,
 * PROV) or the demo's `urn:example:` residue space (RFC 6963 — deliberately
 * non-dereferenceable local identities; the house no-minted-IRIs rule).
 */

import { type LendingResourceKind, RESOURCE_TARGET_CLASSES } from "@lending/data-model";

export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** W3C Verifiable Credentials 2.0 vocabulary. */
export const CRED = "https://www.w3.org/2018/credentials#";
export const VC_CREDENTIAL = `${CRED}VerifiableCredential`;
export const VC_ISSUER = `${CRED}issuer`;
export const VC_VALID_FROM = `${CRED}validFrom`;
export const VC_VALID_UNTIL = `${CRED}validUntil`;
export const VC_CREDENTIAL_SUBJECT = `${CRED}credentialSubject`;
export const VC_CREDENTIAL_STATUS = `${CRED}credentialStatus`;
export const VC_CREDENTIAL_SCHEMA = `${CRED}credentialSchema`;

/** W3C Data Integrity / security vocabulary (proof nodes). */
export const SEC = "https://w3id.org/security#";
export const SEC_PROOF = `${SEC}proof`;
export const SEC_DATA_INTEGRITY_PROOF = `${SEC}DataIntegrityProof`;
export const SEC_CRYPTOSUITE = `${SEC}cryptosuite`;
export const SEC_VERIFICATION_METHOD = `${SEC}verificationMethod`;
export const SEC_PROOF_PURPOSE = `${SEC}proofPurpose`;
export const SEC_PROOF_VALUE = `${SEC}proofValue`;
export const SEC_ASSERTION_METHOD = `${SEC}assertionMethod`;

/** Data Integrity proof `created` timestamps use dcterms:created. */
export const DC_CREATED = "http://purl.org/dc/terms/created";

/** W3C Bitstring Status List vocabulary. */
export const STATUS = "https://www.w3.org/ns/credentials/status#";
export const STATUS_BITSTRING_ENTRY = `${STATUS}BitstringStatusListEntry`;
export const STATUS_PURPOSE = `${STATUS}statusPurpose`;
export const STATUS_LIST_INDEX = `${STATUS}statusListIndex`;
export const STATUS_LIST_CREDENTIAL = `${STATUS}statusListCredential`;

/** W3C PROV (the cash-flow score's derived-from edge, §6.2 row 4). */
export const PROV_WAS_DERIVED_FROM = "http://www.w3.org/ns/prov#wasDerivedFrom";

/** XSD datatypes. */
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const XSD_DATE = `${XSD}date`;
export const XSD_DATE_TIME = `${XSD}dateTime`;
export const XSD_DECIMAL = `${XSD}decimal`;

/** The demo's SHACL shape identities (credentialSchema targets). */
export const LSHAPE = "urn:example:lend-shape#";

const SHAPE_LOCAL_NAMES: Readonly<Record<CredentialKind, string>> = {
  "identity-credential": "IdentityCredentialShape",
  "employment-income-credential": "EmploymentIncomeCredentialShape",
  "bank-cashflow-credential": "BankCashFlowCredentialShape",
  "cashflow-score-credential": "CashFlowScoreCredentialShape",
  "credit-score-credential": "CreditScoreCredentialShape",
  "loan-offer-credential": "LoanOfferCredentialShape",
  "disbursement-receipt-credential": "DisbursementReceiptCredentialShape",
  "repayment-history-credential": "RepaymentHistoryCredentialShape",
  "zk-operand-anchor": "ZkOperandAnchorShape",
};

/** The data-model resource kinds that are Verifiable Credentials (issuable here). */
export type CredentialKind =
  | "identity-credential"
  | "employment-income-credential"
  | "bank-cashflow-credential"
  | "cashflow-score-credential"
  | "credit-score-credential"
  | "loan-offer-credential"
  | "disbursement-receipt-credential"
  | "repayment-history-credential"
  | "zk-operand-anchor";

/** `cred:credentialSchema` IRI per credential kind. */
export function credentialSchemaIri(kind: CredentialKind): string {
  return `${LSHAPE}${SHAPE_LOCAL_NAMES[kind]}`;
}

/** The `sh:targetClass` (lend class) of a credential kind. */
export function targetClassOf(kind: CredentialKind): string {
  return RESOURCE_TARGET_CLASSES[kind];
}

/** Narrow a data-model resource kind to a credential kind, or `undefined`. */
export function asCredentialKind(kind: LendingResourceKind): CredentialKind | undefined {
  return kind in SHAPE_LOCAL_NAMES ? (kind as CredentialKind) : undefined;
}

/** The credential kind whose target class appears in `types`, or `undefined`. */
export function credentialKindOfTypes(types: readonly string[]): CredentialKind | undefined {
  const kinds = Object.keys(SHAPE_LOCAL_NAMES) as readonly CredentialKind[];
  return kinds.find((kind) => types.includes(RESOURCE_TARGET_CLASSES[kind]));
}
