/**
 * `@lending/data-model` — vocabulary bindings, SHACL shapes and typed
 * accessors for the small-dollar lending walkthrough's pod resources
 * (design §6.2).
 *
 * House rules: all RDF through typed `@rdfjs/wrapper` accessors; Turtle out
 * only via the sanctioned serializer behind `resourceToTurtle()`
 * (SHACL-gated); only real dereferenceable namespaces (FIBO, schema.org,
 * W3C VC/DPV/ODRL/PROV, DCMI) or `urn:example:` local identities — never
 * minted http IRIs.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export {
  type Persona,
  PERSONA_VALUES,
  PERSONA_ZK_FIELD_VALUES,
  type PersonaFactoryOptions,
  type PersonaId,
  type PersonaIssuers,
  type PersonaResource,
  type PersonaResourceKind,
  type PersonaValues,
  personas,
  RESOURCE_POD_PATHS,
  ZK_PREQUAL_THRESHOLDS,
} from "./personas.ts";
export {
  type LendingResourceKind,
  RESOURCE_TARGET_CLASSES,
  type ShaclReport,
  type ShaclViolation,
  type ValidateOptions,
  validate,
} from "./shacl.ts";
export {
  ALL_SHAPES_DOCUMENTS,
  SHAPES_DOCUMENT_KEYS,
  SHAPES_TURTLE,
  type ShapesDocumentKey,
} from "./shapes/shapes.ts";
export {
  CRED,
  DCTERMS,
  DPV,
  FIBO,
  ODRL,
  PROV,
  RDF_TYPE,
  SCHEMA,
  TURTLE_PREFIXES,
  XSD,
} from "./vocab/external.ts";
export {
  LEND,
  LEND_NAMESPACE,
  LEND_ONTOLOGY_IRI,
  type LendTermIri,
  type LendTermKey,
} from "./vocab/lend.ts";
export {
  type BankCashFlowCredentialInit,
  buildBankCashFlowCredential,
  buildCashFlowScoreCredential,
  buildConsentReceipt,
  buildCreditScoreCredential,
  buildDisbursementReceiptCredential,
  buildEmploymentIncomeCredential,
  buildIdentityCredential,
  buildLoanOfferCredential,
  buildRepaymentHistoryCredential,
  buildZkOperandAnchor,
  type CashFlowScoreCredentialInit,
  type ConsentReceiptInit,
  type CredentialEnvelopeInit,
  type CreditScoreCredentialInit,
  type DepositStreamInit,
  type DisbursementReceiptCredentialInit,
  type EmploymentIncomeCredentialInit,
  type IdentityCredentialInit,
  type LoanOfferCredentialInit,
  type PostalAddressInit,
  type RepaymentHistoryCredentialInit,
  type ZkOperandAnchorInit,
} from "./wrappers/build.ts";
export { literalFromXsdDate, literalFromXsdDecimal } from "./wrappers/mappings.ts";
export {
  BankCashFlowCredential,
  BankCashFlowSubject,
  CASH_FLOW_SCORE_MODEL_IRIS,
  CashFlowScoreCredential,
  CashFlowScoreSubject,
  CONSENT_STATUS_IRIS,
  ConsentReceipt,
  CREDIT_SCORE_MODEL_IRIS,
  CredentialResource,
  CreditScoreCredential,
  CreditScoreSubject,
  DisbursementReceiptCredential,
  DisbursementReceiptSubject,
  DisbursementTransfer,
  EmploymentIncomeCredential,
  EmploymentIncomeSubject,
  IdentityCredential,
  IdentitySubject,
  LendingResource,
  LoanOfferCredential,
  LoanOfferSubject,
  LoanOfferTerms,
  PAYMENT_RAIL_IRIS,
  PaymentHistory,
  RepaymentHistoryCredential,
  RepaymentHistorySubject,
  ZkOperandAnchor,
  ZkOperandAnchorSubject,
} from "./wrappers/resources.ts";
export { resourceToTurtle, ShapeViolationError } from "./wrappers/serialize.ts";
export {
  DepositAccount,
  DepositStream,
  MonetaryAmount,
  OrganizationNode,
  PostalAddress,
  RepaymentSpecification,
  TypedNode,
} from "./wrappers/support.ts";
export {
  fitsZkBudget,
  ZK_ANCHORABLE_FIELD_IRIS,
  ZK_FIELD_BUDGETS,
  type ZkFieldBudget,
  zkBudgetFor,
} from "./zk-budgets.ts";

/** Real namespace used by the persona seed shape (kept for seeds/). */
export const SCHEMA_ORG = "https://schema.org/";

/** The persona card's local shape identity (RFC 6963 example URN). */
export const PERSONA_SHAPE_IRI = "urn:example:shape:persona";

export const shapesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "shapes");
export const personaShapePath = join(shapesDir, "persona.ttl");
