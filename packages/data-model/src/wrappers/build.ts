import type { Term } from "@rdfjs/types";
import { type ITermWrapperConstructor, RequiredAs, TermFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { CRED, DPV, FIBO, SCHEMA } from "../vocab/external.ts";
import { LEND } from "../vocab/lend.ts";
import {
  BankCashFlowCredential,
  CashFlowScoreCredential,
  ConsentReceipt,
  type CredentialResource,
  CreditScoreCredential,
  DisbursementReceiptCredential,
  DisbursementTransfer,
  EmploymentIncomeCredential,
  IdentityCredential,
  LoanOfferCredential,
  LoanOfferTerms,
  RepaymentHistoryCredential,
  ZkOperandAnchor,
} from "./resources.ts";
import {
  DepositAccount,
  DepositStream,
  MonetaryAmount,
  OrganizationNode,
  PostalAddress,
  RepaymentSpecification,
  type TypedNode,
} from "./support.ts";

/**
 * Build functions: plain init objects in, shape-conforming wrapper instances
 * out. Every triple is created through the `@rdfjs/wrapper` accessors (house
 * rule — no hand-built quads, no string Turtle), into a fresh `n3.Store` with
 * one shared `DataFactory`.
 *
 * Determinism: blank nodes carry explicit, per-document-unique labels and
 * every builder adds triples in a fixed order, so identical inits serialise
 * to byte-identical Turtle (the persona fixtures rely on this).
 */

function newDocument(rootIri: string): { store: Store; root: Term } {
  const store = new Store();
  return { store, root: DataFactory.namedNode(rootIri) };
}

/** Link `parent --predicate--> node` through the wrapper layer. */
function link(parent: TypedNode, predicate: string, node: Term): void {
  RequiredAs.object(parent, predicate, node, TermFrom.itself);
}

function blank(label: string): Term {
  return DataFactory.blankNode(label);
}

function wrap<T>(ctor: ITermWrapperConstructor<T>, term: Term, anchor: TypedNode): T {
  return new ctor(term, anchor.dataset, anchor.factory);
}

export interface PostalAddressInit {
  streetAddress: string;
  addressLocality: string;
  /** Two-letter US state code. */
  addressRegion: string;
  /** US ZIP or ZIP+4. */
  postalCode: string;
}

function addPostalAddress(
  parent: TypedNode,
  predicate: string,
  init: PostalAddressInit,
  label: string,
): void {
  const node = blank(label);
  link(parent, predicate, node);
  const address = wrap(PostalAddress, node, parent);
  address.typeIris.add(SCHEMA.PostalAddress);
  address.streetAddress = init.streetAddress;
  address.addressLocality = init.addressLocality;
  address.addressRegion = init.addressRegion;
  address.postalCode = init.postalCode;
}

function addMonetaryAmount(parent: TypedNode, predicate: string, usd: number, label: string): void {
  const node = blank(label);
  link(parent, predicate, node);
  const amount = wrap(MonetaryAmount, node, parent);
  amount.typeIris.add(SCHEMA.MonetaryAmount);
  amount.amountValue = usd;
  amount.currency = "USD";
}

function addOrganization(parent: TypedNode, predicate: string, name: string, label: string): void {
  const node = blank(label);
  link(parent, predicate, node);
  const organization = wrap(OrganizationNode, node, parent);
  organization.typeIris.add(SCHEMA.Organization);
  organization.organizationName = name;
}

/** The W3C VC 2.0 envelope shared by the credential builders. */
export interface CredentialEnvelopeInit {
  /** The credential's own pod resource IRI. */
  iri: string;
  /** Issuer identity IRI. */
  issuer: string;
  validFrom: Date;
  validUntil?: Date;
  /** Status-list entry IRI. */
  credentialStatus: string;
  /** The borrower WebID (holder binding). */
  credentialSubject: string;
}

function applyEnvelope(
  credential: CredentialResource,
  init: CredentialEnvelopeInit,
  lendType: string,
): void {
  credential.typeIris.add(CRED.VerifiableCredential);
  credential.typeIris.add(lendType);
  credential.issuer = init.issuer;
  credential.validFrom = init.validFrom;
  if (init.validUntil !== undefined) credential.validUntil = init.validUntil;
  credential.credentialStatusIri = init.credentialStatus;
  credential.credentialSubjectIri = init.credentialSubject;
}

export interface IdentityCredentialInit extends CredentialEnvelopeInit {
  name: string;
  birthDate: Date;
  address: PostalAddressInit;
}

export function buildIdentityCredential(init: IdentityCredentialInit): IdentityCredential {
  const { store, root } = newDocument(init.iri);
  const credential = new IdentityCredential(root, store, DataFactory);
  applyEnvelope(credential, init, LEND.IdentityCredential);
  const subject = credential.credentialSubject;
  subject.personName = init.name;
  subject.birthDate = init.birthDate;
  addPostalAddress(subject, SCHEMA.address, init.address, "identityAddress");
  return credential;
}

export interface EmploymentIncomeCredentialInit extends CredentialEnvelopeInit {
  employerName: string;
  jobTitle: string;
  startDate: Date;
  /** ZK field: whole USD/month inside the 4-digit budget. */
  netMonthlyIncomeUsd: number;
}

export function buildEmploymentIncomeCredential(
  init: EmploymentIncomeCredentialInit,
): EmploymentIncomeCredential {
  const { store, root } = newDocument(init.iri);
  const credential = new EmploymentIncomeCredential(root, store, DataFactory);
  applyEnvelope(credential, init, LEND.EmploymentIncomeCredential);
  const subject = credential.credentialSubject;
  addOrganization(subject, SCHEMA.worksFor, init.employerName, "employer");
  subject.jobTitle = init.jobTitle;
  subject.startDate = init.startDate;
  subject.netMonthlyIncomeUsd = init.netMonthlyIncomeUsd;
  return credential;
}

export interface DepositStreamInit {
  /** Display name, e.g. "Payroll — staffing agency". */
  name: string;
  /** Net monthly deposit attributed to this stream (display USD). */
  monthlyAmountUsd: number;
}

export interface BankCashFlowCredentialInit extends CredentialEnvelopeInit {
  providerName: string;
  /** Exactly four digits — the full account number never enters the pod. */
  accountLast4: string;
  depositStreams: readonly DepositStreamInit[];
  /** ZK field inside the 2-digit budget (0..99). */
  nsf90Count: number;
  averageDailyBalanceUsd: number;
  observationMonths: number;
}

export function buildBankCashFlowCredential(
  init: BankCashFlowCredentialInit,
): BankCashFlowCredential {
  const { store, root } = newDocument(init.iri);
  const credential = new BankCashFlowCredential(root, store, DataFactory);
  applyEnvelope(credential, init, LEND.BankCashFlowCredential);
  const subject = credential.credentialSubject;
  const accountNode = blank("cashFlowAccount");
  link(subject, SCHEMA.owns, accountNode);
  const account = wrap(DepositAccount, accountNode, subject);
  account.typeIris.add(SCHEMA.DepositAccount);
  addOrganization(account, SCHEMA.provider, init.providerName, "cashFlowProvider");
  account.accountLast4 = init.accountLast4;
  const streams = subject.depositStreams;
  init.depositStreams.forEach((streamInit, index) => {
    // Multi-valued: add through the live set (a single-object setter would
    // REPLACE the previous stream).
    const stream = wrap(DepositStream, blank(`depositStream${index}`), subject);
    stream.typeIris.add(LEND.DepositStream);
    stream.streamName = streamInit.name;
    addMonetaryAmount(stream, SCHEMA.amount, streamInit.monthlyAmountUsd, `streamAmount${index}`);
    streams.add(stream);
  });
  subject.nsf90Count = init.nsf90Count;
  addMonetaryAmount(
    subject,
    LEND.hasAverageDailyBalance,
    init.averageDailyBalanceUsd,
    "averageDailyBalance",
  );
  subject.observationMonths = init.observationMonths;
  return credential;
}

export interface CashFlowScoreCredentialInit extends CredentialEnvelopeInit {
  /** ZK field inside the 3-digit budget (300..850). */
  cashFlowScoreValue: number;
  /** One of {@link CASH_FLOW_SCORE_MODEL_IRIS}; defaults to CashFlowV1. */
  scoreModel?: string;
  /** The bank cash-flow credential pod resource this score derives from. */
  derivedFrom: string;
}

export function buildCashFlowScoreCredential(
  init: CashFlowScoreCredentialInit,
): CashFlowScoreCredential {
  const { store, root } = newDocument(init.iri);
  const credential = new CashFlowScoreCredential(root, store, DataFactory);
  applyEnvelope(credential, init, LEND.CashFlowScoreCredential);
  credential.derivedFromIri = init.derivedFrom;
  const subject = credential.credentialSubject;
  subject.cashFlowScoreValue = init.cashFlowScoreValue;
  subject.scoreModel = init.scoreModel ?? LEND.ScoreModel_CashFlowV1;
  return credential;
}

export interface CreditScoreCredentialInit extends CredentialEnvelopeInit {
  /** Bureau score points (300..850). */
  creditScoreValue: number;
  tradelineCount: number;
  creditHistoryMonths: number;
  /** One of {@link CREDIT_SCORE_MODEL_IRIS}; defaults to BureauClassic. */
  scoreModel?: string;
}

export function buildCreditScoreCredential(init: CreditScoreCredentialInit): CreditScoreCredential {
  const { store, root } = newDocument(init.iri);
  const credential = new CreditScoreCredential(root, store, DataFactory);
  applyEnvelope(credential, init, LEND.CreditScoreCredential);
  const subject = credential.credentialSubject;
  subject.creditScoreValue = init.creditScoreValue;
  subject.tradelineCount = init.tradelineCount;
  subject.creditHistoryMonths = init.creditHistoryMonths;
  subject.scoreModel = init.scoreModel ?? LEND.ScoreModel_BureauClassic;
  return credential;
}

export interface LoanOfferCredentialInit extends CredentialEnvelopeInit {
  principalUsd: number;
  /** APR in percent, e.g. 32.9. */
  aprPercent: number;
  financeChargeUsd: number;
  totalOfPaymentsUsd: number;
  loanTermMonths: number;
  numberOfPayments: number;
  paymentAmountUsd: number;
  /** Payments per year (12 = monthly). */
  paymentsPerYear: number;
}

export function buildLoanOfferCredential(init: LoanOfferCredentialInit): LoanOfferCredential {
  const { store, root } = newDocument(init.iri);
  const credential = new LoanOfferCredential(root, store, DataFactory);
  applyEnvelope(credential, init, LEND.LoanOfferCredential);
  const subject = credential.credentialSubject;
  const loanNode = blank("offeredLoan");
  link(subject, LEND.hasLoanOffer, loanNode);
  const loan = wrap(LoanOfferTerms, loanNode, subject);
  loan.typeIris.add(FIBO.UnsecuredConsumerLoan);
  loan.typeIris.add(FIBO.ClosedEndCredit);
  loan.typeIris.add(SCHEMA.LoanOrCredit);
  addMonetaryAmount(loan, FIBO.hasPrincipalAmount, init.principalUsd, "principalAmount");
  loan.aprPercent = init.aprPercent;
  addMonetaryAmount(loan, LEND.hasFinanceCharge, init.financeChargeUsd, "financeCharge");
  addMonetaryAmount(loan, LEND.hasTotalOfPayments, init.totalOfPaymentsUsd, "totalOfPayments");
  loan.loanTermMonths = init.loanTermMonths;
  const scheduleNode = blank("paymentSchedule");
  link(loan, SCHEMA.loanRepaymentForm, scheduleNode);
  const schedule = wrap(RepaymentSpecification, scheduleNode, loan);
  schedule.typeIris.add(SCHEMA.RepaymentSpecification);
  schedule.numberOfLoanPayments = init.numberOfPayments;
  addMonetaryAmount(schedule, SCHEMA.loanPaymentAmount, init.paymentAmountUsd, "paymentAmount");
  schedule.loanPaymentFrequency = init.paymentsPerYear;
  return credential;
}

export interface DisbursementReceiptCredentialInit extends CredentialEnvelopeInit {
  amountUsd: number;
  /** Initiation instant. */
  initiatedAt: Date;
  /** Settlement instant (must be after initiation - shape-enforced). */
  settledAt: Date;
  /** Destination card, masked. */
  cardLast4: string;
  /** The accepted loan offer this disbursement funds. */
  fundsOffer?: string;
}

export function buildDisbursementReceiptCredential(
  init: DisbursementReceiptCredentialInit,
): DisbursementReceiptCredential {
  const { store, root } = newDocument(init.iri);
  const credential = new DisbursementReceiptCredential(root, store, DataFactory);
  applyEnvelope(credential, init, LEND.DisbursementReceiptCredential);
  if (init.fundsOffer !== undefined) credential.derivedFromIri = init.fundsOffer;
  const subject = credential.credentialSubject;
  const transferNode = blank("disbursement");
  link(subject, LEND.hasDisbursement, transferNode);
  const transfer = wrap(DisbursementTransfer, transferNode, subject);
  transfer.typeIris.add(SCHEMA.MoneyTransfer);
  addMonetaryAmount(transfer, SCHEMA.amount, init.amountUsd, "disbursedAmount");
  transfer.startTime = init.initiatedAt;
  transfer.endTime = init.settledAt;
  transfer.paymentRail = LEND.PaymentRail_PushToCard;
  transfer.cardLast4 = init.cardLast4;
  return credential;
}

export interface RepaymentHistoryCredentialInit extends CredentialEnvelopeInit {
  /** The funded loan-offer pod resource the history reports on. */
  servicedLoan: string;
  onTimePaymentCount: number;
  latePaymentCount: number;
  scheduledPaymentCount: number;
  periodStart: Date;
  periodEnd: Date;
}

export function buildRepaymentHistoryCredential(
  init: RepaymentHistoryCredentialInit,
): RepaymentHistoryCredential {
  const { store, root } = newDocument(init.iri);
  const credential = new RepaymentHistoryCredential(root, store, DataFactory);
  applyEnvelope(credential, init, LEND.RepaymentHistoryCredential);
  const subject = credential.credentialSubject;
  const historyNode = blank("paymentHistory");
  link(subject, FIBO.hasPaymentHistory, historyNode);
  const history = subject.paymentHistory;
  history.typeIris.add(FIBO.PaymentHistory);
  history.servicedLoanIri = init.servicedLoan;
  history.onTimePaymentCount = init.onTimePaymentCount;
  history.latePaymentCount = init.latePaymentCount;
  history.scheduledPaymentCount = init.scheduledPaymentCount;
  history.periodStart = init.periodStart;
  history.periodEnd = init.periodEnd;
  return credential;
}

export interface ConsentReceiptInit {
  iri: string;
  dataSubject: string;
  dataController: string;
  target: string;
  /** One of `CONSENT_STATUS_IRIS`. */
  consentStatus: string;
  issued: Date;
}

/** Build one SHACL-validated app-level consent receipt. */
export function buildConsentReceipt(init: ConsentReceiptInit): ConsentReceipt {
  const { store, root } = newDocument(init.iri);
  const receipt = new ConsentReceipt(root, store, DataFactory);
  receipt.typeIris.add(DPV.ConsentReceipt);
  receipt.dataSubjectIri = init.dataSubject;
  receipt.dataControllerIri = init.dataController;
  receipt.targetIri = init.target;
  receipt.consentStatus = init.consentStatus;
  receipt.issued = init.issued;
  return receipt;
}

export interface ZkOperandAnchorInit extends CredentialEnvelopeInit {
  /** One of the three ZK field IRIs (ZK_ANCHORABLE_FIELD_IRIS). */
  field: string;
  /** Deterministic sparq operand encoding (0x-prefixed lowercase hex). */
  operandEnc: string;
}

export function buildZkOperandAnchor(init: ZkOperandAnchorInit): ZkOperandAnchor {
  const { store, root } = newDocument(init.iri);
  const anchor = new ZkOperandAnchor(root, store, DataFactory);
  applyEnvelope(anchor, init, LEND.ZkOperandAnchor);
  const subject = anchor.credentialSubject;
  subject.fieldIri = init.field;
  subject.operandEnc = init.operandEnc;
  return anchor;
}
