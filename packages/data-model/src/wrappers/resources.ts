import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  RequiredAs,
  RequiredFrom,
  SetFrom,
  TermAs,
} from "@rdfjs/wrapper";
import type { LendingResourceKind } from "../shacl.ts";
import { CRED, DCTERMS, DPV, FIBO, ODRL, PROV, SCHEMA } from "../vocab/external.ts";
import { LEND } from "../vocab/lend.ts";
import { fitsZkBudget, ZK_ANCHORABLE_FIELD_IRIS } from "../zk-budgets.ts";
import { literalFromXsdDate, literalFromXsdDecimal } from "./mappings.ts";
import {
  DepositAccount,
  DepositStream,
  MonetaryAmount,
  OrganizationNode,
  PostalAddress,
  RepaymentSpecification,
  TypedNode,
} from "./support.ts";

/**
 * Typed accessors over the eight §6.2 lending credentials plus the consent
 * receipt and the ZK operand anchor (shapes/*.ttl). Reading AND building go
 * through these wrappers — app code never walks datasets or concatenates
 * Turtle. Setters enforce the cheap invariants early (ZK digit budgets,
 * controlled-vocabulary membership); `resourceToTurtle()` then validates the
 * full document against the matching SHACL shape before any bytes leave the
 * process.
 */
export abstract class LendingResource extends TypedNode {
  /** The shapes/validate() kind this wrapper's document must conform to. */
  abstract get resourceKind(): LendingResourceKind;
}

function assertMember(label: string, value: string, allowed: readonly string[]): void {
  if (!allowed.includes(value)) {
    throw new RangeError(`${label} must be one of ${allowed.join(", ")}; got ${value}`);
  }
}

/** Value space of `lend:scoreModel` on cash-flow score credentials. */
export const CASH_FLOW_SCORE_MODEL_IRIS = [LEND.ScoreModel_CashFlowV1] as const;

/** Value space of `lend:scoreModel` on bureau credit-score credentials. */
export const CREDIT_SCORE_MODEL_IRIS = [LEND.ScoreModel_BureauClassic] as const;

/** Value space of `lend:paymentRail`. */
export const PAYMENT_RAIL_IRIS = [LEND.PaymentRail_PushToCard] as const;

/** Consent receipt states used by the app-level scene-5 ledger. */
export const CONSENT_STATUS_IRIS = [DPV.ConsentGiven, DPV.ConsentWithdrawn] as const;

/**
 * Shared accessors of the credential resources (W3C VC 2.0 envelope).
 * `validUntil` is optional at this level because anchors and disbursement
 * receipts revoke rather than expire; the per-kind shape enforces
 * requiredness at serialize.
 */
export abstract class CredentialResource extends LendingResource {
  get issuer(): string {
    return RequiredFrom.subjectPredicate(this, CRED.issuer, NamedNodeAs.string);
  }
  set issuer(value: string) {
    RequiredAs.object(this, CRED.issuer, value, NamedNodeFrom.string);
  }

  get validFrom(): Date {
    return RequiredFrom.subjectPredicate(this, CRED.validFrom, LiteralAs.date);
  }
  set validFrom(value: Date) {
    RequiredAs.object(this, CRED.validFrom, value, LiteralFrom.dateTime);
  }

  get validUntil(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, CRED.validUntil, LiteralAs.date);
  }
  set validUntil(value: Date | undefined) {
    OptionalAs.object(this, CRED.validUntil, value, LiteralFrom.dateTime);
  }

  /**
   * The status-list entry IRI (Bitstring Status List per issuer app). The
   * shapes also admit a blank node; this accessor covers the IRI form the
   * suite's issuers emit and throws on anything else.
   */
  get credentialStatusIri(): string {
    return RequiredFrom.subjectPredicate(this, CRED.credentialStatus, NamedNodeAs.string);
  }
  set credentialStatusIri(value: string) {
    RequiredAs.object(this, CRED.credentialStatus, value, NamedNodeFrom.string);
  }

  /** The borrower WebID (holder binding). */
  get credentialSubjectIri(): string {
    return RequiredFrom.subjectPredicate(this, CRED.credentialSubject, NamedNodeAs.string);
  }
  set credentialSubjectIri(value: string) {
    RequiredAs.object(this, CRED.credentialSubject, value, NamedNodeFrom.string);
  }

  /** `cred:credentialSchema` IRIs (unbounded; live write-through set). */
  get credentialSchemaIris(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      CRED.credentialSchema,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}

/** Claims node of the identity VC (lshape:IdentitySubjectShape). */
export class IdentitySubject extends TypedNode {
  get personName(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.name, LiteralAs.string);
  }
  set personName(value: string) {
    RequiredAs.object(this, SCHEMA.name, value, LiteralFrom.string);
  }

  get birthDate(): Date {
    return RequiredFrom.subjectPredicate(this, SCHEMA.birthDate, LiteralAs.date);
  }
  set birthDate(value: Date) {
    RequiredAs.object(this, SCHEMA.birthDate, value, literalFromXsdDate);
  }

  get address(): PostalAddress {
    return RequiredFrom.subjectPredicate(this, SCHEMA.address, TermAs.instance(PostalAddress));
  }
}

/** §6.2 row 1: the KYC/CIP identity VC (lshape:IdentityCredentialShape). */
export class IdentityCredential extends CredentialResource {
  override get resourceKind(): LendingResourceKind {
    return "identity-credential";
  }

  get credentialSubject(): IdentitySubject {
    return RequiredFrom.subjectPredicate(
      this,
      CRED.credentialSubject,
      TermAs.instance(IdentitySubject),
    );
  }
}

/** Claims node of the employment + income VC (lshape:EmploymentIncomeSubjectShape). */
export class EmploymentIncomeSubject extends TypedNode {
  get worksFor(): OrganizationNode {
    return RequiredFrom.subjectPredicate(this, SCHEMA.worksFor, TermAs.instance(OrganizationNode));
  }

  get jobTitle(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.jobTitle, LiteralAs.string);
  }
  set jobTitle(value: string) {
    RequiredAs.object(this, SCHEMA.jobTitle, value, LiteralFrom.string);
  }

  get startDate(): Date {
    return RequiredFrom.subjectPredicate(this, SCHEMA.startDate, LiteralAs.date);
  }
  set startDate(value: Date) {
    RequiredAs.object(this, SCHEMA.startDate, value, literalFromXsdDate);
  }

  /** ZK field: whole USD/month, 4-digit budget, filter_int_d4. */
  get netMonthlyIncomeUsd(): number {
    return RequiredFrom.subjectPredicate(this, LEND.netMonthlyIncomeUsd, LiteralAs.number);
  }
  set netMonthlyIncomeUsd(value: number) {
    if (!fitsZkBudget(LEND.netMonthlyIncomeUsd, value)) {
      throw new RangeError(
        `netMonthlyIncomeUsd ${value} breaks the 4-digit ZK budget (0..9999 whole USD/month)`,
      );
    }
    RequiredAs.object(this, LEND.netMonthlyIncomeUsd, value, LiteralFrom.integer);
  }
}

/** §6.2 row 2: employment + income VC (lshape:EmploymentIncomeCredentialShape). */
export class EmploymentIncomeCredential extends CredentialResource {
  override get resourceKind(): LendingResourceKind {
    return "employment-income-credential";
  }

  get credentialSubject(): EmploymentIncomeSubject {
    return RequiredFrom.subjectPredicate(
      this,
      CRED.credentialSubject,
      TermAs.instance(EmploymentIncomeSubject),
    );
  }
}

/** Claims node of the bank cash-flow VC (lshape:BankCashFlowSubjectShape). */
export class BankCashFlowSubject extends TypedNode {
  /** The masked account the attributes were computed over. */
  get account(): DepositAccount {
    return RequiredFrom.subjectPredicate(this, SCHEMA.owns, TermAs.instance(DepositAccount));
  }

  /** Observed deposit streams (at least one; live write-through set). */
  get depositStreams(): Set<DepositStream> {
    return SetFrom.subjectPredicate(
      this,
      LEND.hasDepositStream,
      TermAs.instance(DepositStream),
      (value, _factory) => TermAs.term(value),
    );
  }

  /** ZK field: 2-digit budget, filter_int_d2 (NSF90 = 0 equality-to-zero). */
  get nsf90Count(): number {
    return RequiredFrom.subjectPredicate(this, LEND.nsf90Count, LiteralAs.number);
  }
  set nsf90Count(value: number) {
    if (!fitsZkBudget(LEND.nsf90Count, value)) {
      throw new RangeError(`nsf90Count ${value} breaks the 2-digit ZK budget (0..99 events)`);
    }
    RequiredAs.object(this, LEND.nsf90Count, value, LiteralFrom.integer);
  }

  get averageDailyBalance(): MonetaryAmount {
    return RequiredFrom.subjectPredicate(
      this,
      LEND.hasAverageDailyBalance,
      TermAs.instance(MonetaryAmount),
    );
  }

  get observationMonths(): number {
    return RequiredFrom.subjectPredicate(this, LEND.observationMonths, LiteralAs.number);
  }
  set observationMonths(value: number) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 36) {
      throw new RangeError(`observationMonths must be an integer in 1..36, got ${value}`);
    }
    RequiredAs.object(this, LEND.observationMonths, value, LiteralFrom.integer);
  }
}

/** §6.2 row 3: FDX-shaped bank cash-flow VC (lshape:BankCashFlowCredentialShape). */
export class BankCashFlowCredential extends CredentialResource {
  override get resourceKind(): LendingResourceKind {
    return "bank-cashflow-credential";
  }

  get credentialSubject(): BankCashFlowSubject {
    return RequiredFrom.subjectPredicate(
      this,
      CRED.credentialSubject,
      TermAs.instance(BankCashFlowSubject),
    );
  }
}

/** Claims node of the cash-flow score VC (lshape:CashFlowScoreSubjectShape). */
export class CashFlowScoreSubject extends TypedNode {
  /** ZK field: 3-digit budget (300..850), filter_int_d3. */
  get cashFlowScoreValue(): number {
    return RequiredFrom.subjectPredicate(this, LEND.cashFlowScoreValue, LiteralAs.number);
  }
  set cashFlowScoreValue(value: number) {
    if (!fitsZkBudget(LEND.cashFlowScoreValue, value)) {
      throw new RangeError(`cashFlowScoreValue ${value} breaks the 3-digit ZK budget (300..850)`);
    }
    RequiredAs.object(this, LEND.cashFlowScoreValue, value, LiteralFrom.integer);
  }

  get scoreModel(): string {
    return RequiredFrom.subjectPredicate(this, LEND.scoreModel, NamedNodeAs.string);
  }
  set scoreModel(value: string) {
    assertMember("scoreModel", value, CASH_FLOW_SCORE_MODEL_IRIS);
    RequiredAs.object(this, LEND.scoreModel, value, NamedNodeFrom.string);
  }
}

/** §6.2 row 4: cash-flow score VC (lshape:CashFlowScoreCredentialShape). */
export class CashFlowScoreCredential extends CredentialResource {
  override get resourceKind(): LendingResourceKind {
    return "cashflow-score-credential";
  }

  get credentialSubject(): CashFlowScoreSubject {
    return RequiredFrom.subjectPredicate(
      this,
      CRED.credentialSubject,
      TermAs.instance(CashFlowScoreSubject),
    );
  }

  /** The bank cash-flow credential this score derives from (required). */
  get derivedFromIri(): string {
    return RequiredFrom.subjectPredicate(this, PROV.wasDerivedFrom, NamedNodeAs.string);
  }
  set derivedFromIri(value: string) {
    RequiredAs.object(this, PROV.wasDerivedFrom, value, NamedNodeFrom.string);
  }
}

/** Claims node of the bureau credit-score VC (lshape:CreditScoreSubjectShape). */
export class CreditScoreSubject extends TypedNode {
  /** Disclosed display score (300..850) — the "old rail"; not a ZK field. */
  get creditScoreValue(): number {
    return RequiredFrom.subjectPredicate(this, LEND.creditScoreValue, LiteralAs.number);
  }
  set creditScoreValue(value: number) {
    if (!Number.isSafeInteger(value) || value < 300 || value > 850) {
      throw new RangeError(`creditScoreValue must be an integer in 300..850, got ${value}`);
    }
    RequiredAs.object(this, LEND.creditScoreValue, value, LiteralFrom.integer);
  }

  /** Thin-file fact: open tradelines on file. */
  get tradelineCount(): number {
    return RequiredFrom.subjectPredicate(this, LEND.tradelineCount, LiteralAs.number);
  }
  set tradelineCount(value: number) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 99) {
      throw new RangeError(`tradelineCount must be an integer in 0..99, got ${value}`);
    }
    RequiredAs.object(this, LEND.tradelineCount, value, LiteralFrom.integer);
  }

  /** Thin-file fact: age of the oldest tradeline in months. */
  get creditHistoryMonths(): number {
    return RequiredFrom.subjectPredicate(this, LEND.creditHistoryMonths, LiteralAs.number);
  }
  set creditHistoryMonths(value: number) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 999) {
      throw new RangeError(`creditHistoryMonths must be an integer in 0..999, got ${value}`);
    }
    RequiredAs.object(this, LEND.creditHistoryMonths, value, LiteralFrom.integer);
  }

  get scoreModel(): string {
    return RequiredFrom.subjectPredicate(this, LEND.scoreModel, NamedNodeAs.string);
  }
  set scoreModel(value: string) {
    assertMember("scoreModel", value, CREDIT_SCORE_MODEL_IRIS);
    RequiredAs.object(this, LEND.scoreModel, value, NamedNodeFrom.string);
  }
}

/** §6.2 row 5: traditional bureau-score VC (lshape:CreditScoreCredentialShape). */
export class CreditScoreCredential extends CredentialResource {
  override get resourceKind(): LendingResourceKind {
    return "credit-score-credential";
  }

  get credentialSubject(): CreditScoreSubject {
    return RequiredFrom.subjectPredicate(
      this,
      CRED.credentialSubject,
      TermAs.instance(CreditScoreSubject),
    );
  }
}

/** The offered consumer instalment loan (lshape:LoanOfferTermsShape). */
export class LoanOfferTerms extends TypedNode {
  /** Amount financed (the principal pushed to the card). */
  get principalAmount(): MonetaryAmount {
    return RequiredFrom.subjectPredicate(
      this,
      FIBO.hasPrincipalAmount,
      TermAs.instance(MonetaryAmount),
    );
  }

  /** APR in percent (e.g. 32.9). */
  get aprPercent(): number {
    return RequiredFrom.subjectPredicate(this, SCHEMA.annualPercentageRate, LiteralAs.number);
  }
  set aprPercent(value: number) {
    if (!Number.isFinite(value) || value < 0 || value >= 100) {
      throw new RangeError(`aprPercent must be in 0..<100, got ${value}`);
    }
    RequiredAs.object(this, SCHEMA.annualPercentageRate, value, literalFromXsdDecimal);
  }

  /** The dollar cost of credit over the life of the loan. */
  get financeCharge(): MonetaryAmount {
    return RequiredFrom.subjectPredicate(
      this,
      LEND.hasFinanceCharge,
      TermAs.instance(MonetaryAmount),
    );
  }

  /** Principal plus finance charge. */
  get totalOfPayments(): MonetaryAmount {
    return RequiredFrom.subjectPredicate(
      this,
      LEND.hasTotalOfPayments,
      TermAs.instance(MonetaryAmount),
    );
  }

  get loanTermMonths(): number {
    return RequiredFrom.subjectPredicate(this, LEND.loanTermMonths, LiteralAs.number);
  }
  set loanTermMonths(value: number) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 120) {
      throw new RangeError(`loanTermMonths must be an integer in 1..120, got ${value}`);
    }
    RequiredAs.object(this, LEND.loanTermMonths, value, LiteralFrom.integer);
  }

  /** The Reg Z payment schedule. */
  get repaymentSpecification(): RepaymentSpecification {
    return RequiredFrom.subjectPredicate(
      this,
      SCHEMA.loanRepaymentForm,
      TermAs.instance(RepaymentSpecification),
    );
  }
}

/** Claims node of the loan offer VC (lshape:LoanOfferSubjectShape). */
export class LoanOfferSubject extends TypedNode {
  get loanOffer(): LoanOfferTerms {
    return RequiredFrom.subjectPredicate(this, LEND.hasLoanOffer, TermAs.instance(LoanOfferTerms));
  }
}

/** §6.2 row 6: loan offer / closed-end disclosure VC (lshape:LoanOfferCredentialShape). */
export class LoanOfferCredential extends CredentialResource {
  override get resourceKind(): LendingResourceKind {
    return "loan-offer-credential";
  }

  get credentialSubject(): LoanOfferSubject {
    return RequiredFrom.subjectPredicate(
      this,
      CRED.credentialSubject,
      TermAs.instance(LoanOfferSubject),
    );
  }
}

/** The funding event (lshape:MoneyTransferShape). */
export class DisbursementTransfer extends TypedNode {
  get amount(): MonetaryAmount {
    return RequiredFrom.subjectPredicate(this, SCHEMA.amount, TermAs.instance(MonetaryAmount));
  }

  /** Initiation instant. */
  get startTime(): Date {
    return RequiredFrom.subjectPredicate(this, SCHEMA.startTime, LiteralAs.date);
  }
  set startTime(value: Date) {
    RequiredAs.object(this, SCHEMA.startTime, value, LiteralFrom.dateTime);
  }

  /** Settlement instant (the <=30-minute beat is endTime - startTime). */
  get endTime(): Date {
    return RequiredFrom.subjectPredicate(this, SCHEMA.endTime, LiteralAs.date);
  }
  set endTime(value: Date) {
    RequiredAs.object(this, SCHEMA.endTime, value, LiteralFrom.dateTime);
  }

  get paymentRail(): string {
    return RequiredFrom.subjectPredicate(this, LEND.paymentRail, NamedNodeAs.string);
  }
  set paymentRail(value: string) {
    assertMember("paymentRail", value, PAYMENT_RAIL_IRIS);
    RequiredAs.object(this, LEND.paymentRail, value, NamedNodeFrom.string);
  }

  /** Destination card, masked — the full PAN never enters the pod. */
  get cardLast4(): string {
    return RequiredFrom.subjectPredicate(this, LEND.accountLast4, LiteralAs.string);
  }
  set cardLast4(value: string) {
    if (!/^[0-9]{4}$/.test(value)) {
      throw new RangeError(`cardLast4 must be exactly four digits, got ${JSON.stringify(value)}`);
    }
    RequiredAs.object(this, LEND.accountLast4, value, LiteralFrom.string);
  }
}

/** Claims node of the disbursement receipt (lshape:DisbursementReceiptSubjectShape). */
export class DisbursementReceiptSubject extends TypedNode {
  get disbursement(): DisbursementTransfer {
    return RequiredFrom.subjectPredicate(
      this,
      LEND.hasDisbursement,
      TermAs.instance(DisbursementTransfer),
    );
  }
}

/** §6.2 row 7: push-to-card receipt VC (lshape:DisbursementReceiptCredentialShape). */
export class DisbursementReceiptCredential extends CredentialResource {
  override get resourceKind(): LendingResourceKind {
    return "disbursement-receipt-credential";
  }

  get credentialSubject(): DisbursementReceiptSubject {
    return RequiredFrom.subjectPredicate(
      this,
      CRED.credentialSubject,
      TermAs.instance(DisbursementReceiptSubject),
    );
  }

  /** The accepted loan offer this disbursement funds (optional). */
  get derivedFromIri(): string | undefined {
    return OptionalFrom.subjectPredicate(this, PROV.wasDerivedFrom, NamedNodeAs.string);
  }
  set derivedFromIri(value: string | undefined) {
    OptionalAs.object(this, PROV.wasDerivedFrom, value, NamedNodeFrom.string);
  }
}

/** The reported period's outcomes (lshape:PaymentHistoryShape). */
export class PaymentHistory extends TypedNode {
  /** The funded loan-offer pod resource this history reports on. */
  get servicedLoanIri(): string {
    return RequiredFrom.subjectPredicate(this, LEND.servicedLoan, NamedNodeAs.string);
  }
  set servicedLoanIri(value: string) {
    RequiredAs.object(this, LEND.servicedLoan, value, NamedNodeFrom.string);
  }

  get onTimePaymentCount(): number {
    return RequiredFrom.subjectPredicate(this, LEND.onTimePaymentCount, LiteralAs.number);
  }
  set onTimePaymentCount(value: number) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 999) {
      throw new RangeError(`onTimePaymentCount must be an integer in 0..999, got ${value}`);
    }
    RequiredAs.object(this, LEND.onTimePaymentCount, value, LiteralFrom.integer);
  }

  get latePaymentCount(): number {
    return RequiredFrom.subjectPredicate(this, LEND.latePaymentCount, LiteralAs.number);
  }
  set latePaymentCount(value: number) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 999) {
      throw new RangeError(`latePaymentCount must be an integer in 0..999, got ${value}`);
    }
    RequiredAs.object(this, LEND.latePaymentCount, value, LiteralFrom.integer);
  }

  get scheduledPaymentCount(): number {
    return RequiredFrom.subjectPredicate(this, LEND.scheduledPaymentCount, LiteralAs.number);
  }
  set scheduledPaymentCount(value: number) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 999) {
      throw new RangeError(`scheduledPaymentCount must be an integer in 1..999, got ${value}`);
    }
    RequiredAs.object(this, LEND.scheduledPaymentCount, value, LiteralFrom.integer);
  }

  get periodStart(): Date {
    return RequiredFrom.subjectPredicate(this, SCHEMA.startDate, LiteralAs.date);
  }
  set periodStart(value: Date) {
    RequiredAs.object(this, SCHEMA.startDate, value, literalFromXsdDate);
  }

  get periodEnd(): Date {
    return RequiredFrom.subjectPredicate(this, SCHEMA.endDate, LiteralAs.date);
  }
  set periodEnd(value: Date) {
    RequiredAs.object(this, SCHEMA.endDate, value, literalFromXsdDate);
  }
}

/** Claims node of the repayment-history VC (lshape:RepaymentHistorySubjectShape). */
export class RepaymentHistorySubject extends TypedNode {
  get paymentHistory(): PaymentHistory {
    return RequiredFrom.subjectPredicate(
      this,
      FIBO.hasPaymentHistory,
      TermAs.instance(PaymentHistory),
    );
  }
}

/** §6.2 row 8: the graduation credential (lshape:RepaymentHistoryCredentialShape). */
export class RepaymentHistoryCredential extends CredentialResource {
  override get resourceKind(): LendingResourceKind {
    return "repayment-history-credential";
  }

  get credentialSubject(): RepaymentHistorySubject {
    return RequiredFrom.subjectPredicate(
      this,
      CRED.credentialSubject,
      TermAs.instance(RepaymentHistorySubject),
    );
  }
}

/** App-level DPV consent receipt (WAC is enforcement, not auditing). */
export class ConsentReceipt extends LendingResource {
  override get resourceKind(): LendingResourceKind {
    return "consent-receipt";
  }

  get dataSubjectIri(): string {
    return RequiredFrom.subjectPredicate(this, DPV.hasDataSubject, NamedNodeAs.string);
  }
  set dataSubjectIri(value: string) {
    RequiredAs.object(this, DPV.hasDataSubject, value, NamedNodeFrom.string);
  }

  get dataControllerIri(): string {
    return RequiredFrom.subjectPredicate(this, DPV.hasDataController, NamedNodeAs.string);
  }
  set dataControllerIri(value: string) {
    RequiredAs.object(this, DPV.hasDataController, value, NamedNodeFrom.string);
  }

  get targetIri(): string {
    return RequiredFrom.subjectPredicate(this, ODRL.target, NamedNodeAs.string);
  }
  set targetIri(value: string) {
    RequiredAs.object(this, ODRL.target, value, NamedNodeFrom.string);
  }

  get consentStatus(): string {
    return RequiredFrom.subjectPredicate(this, DPV.hasConsentStatus, NamedNodeAs.string);
  }
  set consentStatus(value: string) {
    assertMember("consentStatus", value, CONSENT_STATUS_IRIS);
    RequiredAs.object(this, DPV.hasConsentStatus, value, NamedNodeFrom.string);
  }

  get issued(): Date {
    return RequiredFrom.subjectPredicate(this, DCTERMS.issued, LiteralAs.date);
  }
  set issued(value: Date) {
    RequiredAs.object(this, DCTERMS.issued, value, LiteralFrom.dateTime);
  }
}

/** Claims node of the operand anchor (lshape:ZkOperandAnchorSubjectShape). */
export class ZkOperandAnchorSubject extends TypedNode {
  /** The anchored ZK field IRI (the three scaled-unit fields only). */
  get fieldIri(): string {
    return RequiredFrom.subjectPredicate(this, LEND.field, NamedNodeAs.string);
  }
  set fieldIri(value: string) {
    assertMember("fieldIri", value, ZK_ANCHORABLE_FIELD_IRIS);
    RequiredAs.object(this, LEND.field, value, NamedNodeFrom.string);
  }

  /** Deterministic salt-free sparq operand encoding (0x-prefixed lowercase hex). */
  get operandEnc(): string {
    return RequiredFrom.subjectPredicate(this, LEND.operandEnc, LiteralAs.string);
  }
  set operandEnc(value: string) {
    if (!/^0x[0-9a-f]{1,64}$/.test(value)) {
      throw new RangeError("operandEnc must be a 0x-prefixed lowercase hex field element");
    }
    RequiredAs.object(this, LEND.operandEnc, value, LiteralFrom.string);
  }
}

/**
 * The issuer-signed operand-anchor VC that makes the next round's Tier-A
 * live filter proofs forgery-resistant (lshape:ZkOperandAnchorShape). Never
 * ship a Tier-A surface without the anchor check.
 */
export class ZkOperandAnchor extends CredentialResource {
  override get resourceKind(): LendingResourceKind {
    return "zk-operand-anchor";
  }

  get credentialSubject(): ZkOperandAnchorSubject {
    return RequiredFrom.subjectPredicate(
      this,
      CRED.credentialSubject,
      TermAs.instance(ZkOperandAnchorSubject),
    );
  }
}
