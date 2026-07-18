/**
 * IRI constants for the real, dereferenceable external vocabularies the
 * lending resources use (design §6.2; house rule: no minted IRIs — project
 * residue terms live in ./lend.ts, generated from vocab/lend.ttl).
 *
 * Only terms the typed wrappers actually read or write are bound here; the
 * SHACL shapes in shapes/*.ttl remain the authority on each term's role.
 */

export const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

const XSD_NS = "http://www.w3.org/2001/XMLSchema#";

/** XSD datatypes needed by the custom literal mappings in wrappers/mappings.ts. */
export const XSD = {
  date: `${XSD_NS}date`,
  decimal: `${XSD_NS}decimal`,
} as const;

const SCHEMA_NS = "https://schema.org/";

/**
 * schema.org terms — person/address/org/money display fields plus the
 * financial extension (LoanOrCredit, RepaymentSpecification, MoneyTransfer,
 * annualPercentageRate) that carries the closed-end disclosure schedule.
 */
export const SCHEMA = {
  DepositAccount: `${SCHEMA_NS}DepositAccount`,
  LoanOrCredit: `${SCHEMA_NS}LoanOrCredit`,
  MonetaryAmount: `${SCHEMA_NS}MonetaryAmount`,
  MoneyTransfer: `${SCHEMA_NS}MoneyTransfer`,
  Organization: `${SCHEMA_NS}Organization`,
  Person: `${SCHEMA_NS}Person`,
  PostalAddress: `${SCHEMA_NS}PostalAddress`,
  RepaymentSpecification: `${SCHEMA_NS}RepaymentSpecification`,
  address: `${SCHEMA_NS}address`,
  addressLocality: `${SCHEMA_NS}addressLocality`,
  addressRegion: `${SCHEMA_NS}addressRegion`,
  amount: `${SCHEMA_NS}amount`,
  annualPercentageRate: `${SCHEMA_NS}annualPercentageRate`,
  birthDate: `${SCHEMA_NS}birthDate`,
  currency: `${SCHEMA_NS}currency`,
  endDate: `${SCHEMA_NS}endDate`,
  endTime: `${SCHEMA_NS}endTime`,
  identifier: `${SCHEMA_NS}identifier`,
  jobTitle: `${SCHEMA_NS}jobTitle`,
  loanPaymentAmount: `${SCHEMA_NS}loanPaymentAmount`,
  loanPaymentFrequency: `${SCHEMA_NS}loanPaymentFrequency`,
  loanRepaymentForm: `${SCHEMA_NS}loanRepaymentForm`,
  name: `${SCHEMA_NS}name`,
  numberOfLoanPayments: `${SCHEMA_NS}numberOfLoanPayments`,
  owns: `${SCHEMA_NS}owns`,
  postalCode: `${SCHEMA_NS}postalCode`,
  provider: `${SCHEMA_NS}provider`,
  startDate: `${SCHEMA_NS}startDate`,
  startTime: `${SCHEMA_NS}startTime`,
  streetAddress: `${SCHEMA_NS}streetAddress`,
  value: `${SCHEMA_NS}value`,
  worksFor: `${SCHEMA_NS}worksFor`,
} as const;

const CRED_NS = "https://www.w3.org/2018/credentials#";

/** W3C VC 2.0 terms (all §6.2 rows are VC 2.0 credentials). */
export const CRED = {
  VerifiableCredential: `${CRED_NS}VerifiableCredential`,
  credentialSchema: `${CRED_NS}credentialSchema`,
  credentialStatus: `${CRED_NS}credentialStatus`,
  credentialSubject: `${CRED_NS}credentialSubject`,
  evidence: `${CRED_NS}evidence`,
  issuer: `${CRED_NS}issuer`,
  validFrom: `${CRED_NS}validFrom`,
  validUntil: `${CRED_NS}validUntil`,
} as const;

const DCTERMS_NS = "http://purl.org/dc/terms/";

/** Dublin Core terms (receipt timestamps). */
export const DCTERMS = {
  created: `${DCTERMS_NS}created`,
  issued: `${DCTERMS_NS}issued`,
} as const;

const DPV_NS = "https://w3id.org/dpv#";

/** DPV consent-receipt terms (the scene-5 consent ledger). */
export const DPV = {
  ConsentGiven: `${DPV_NS}ConsentGiven`,
  ConsentReceipt: `${DPV_NS}ConsentReceipt`,
  ConsentWithdrawn: `${DPV_NS}ConsentWithdrawn`,
  hasConsentStatus: `${DPV_NS}hasConsentStatus`,
  hasDataController: `${DPV_NS}hasDataController`,
  hasDataSubject: `${DPV_NS}hasDataSubject`,
} as const;

const ODRL_NS = "http://www.w3.org/ns/odrl/2/";

/** ODRL relation used to identify the pod resource covered by a receipt. */
export const ODRL = {
  target: `${ODRL_NS}target`,
} as const;

const PROV_NS = "http://www.w3.org/ns/prov#";

/** W3C PROV — the cash-flow-score/receipt derivation edges (§6.2 rows 4/7). */
export const PROV = {
  wasDerivedFrom: `${PROV_NS}wasDerivedFrom`,
} as const;

const FIBO_NS = "https://spec.edmcouncil.org/fibo/ontology/";
const LOAN_LOANS = `${FIBO_NS}LOAN/LoansGeneral/Loans/`;
const LOAN_CONSUMER = `${FIBO_NS}LOAN/LoansSpecific/ConsumerLoans/`;

/**
 * FIBO classes and properties (design §6.2: FIBO LOAN ConsumerLoans +
 * LoansGeneral ground the loan resource). Every term is verified against the
 * published ontology documents — spec.edmcouncil.org serves an SPA that
 * answers 200 for anything, so a HEAD check alone proves nothing.
 */
export const FIBO = {
  // Classes
  ClosedEndCredit: `${LOAN_LOANS}ClosedEndCredit`,
  ConsumerLoan: `${LOAN_CONSUMER}ConsumerLoan`,
  PaymentHistory: `${LOAN_LOANS}PaymentHistory`,
  UnsecuredConsumerLoan: `${LOAN_CONSUMER}UnsecuredConsumerLoan`,
  // Properties
  hasPaymentHistory: `${LOAN_LOANS}hasPaymentHistory`,
  hasPrincipalAmount: `${LOAN_LOANS}hasPrincipalAmount`,
} as const;

/** Prefix map for Turtle serialisation of the lending resources. */
export const TURTLE_PREFIXES: Readonly<Record<string, string>> = {
  cred: CRED_NS,
  dcterms: DCTERMS_NS,
  dpv: DPV_NS,
  "fibo-loan-ln-ln": LOAN_LOANS,
  "fibo-loan-spc-cns": LOAN_CONSUMER,
  lend: "urn:example:lend#",
  odrl: ODRL_NS,
  prov: PROV_NS,
  schema: SCHEMA_NS,
  xsd: XSD_NS,
};
