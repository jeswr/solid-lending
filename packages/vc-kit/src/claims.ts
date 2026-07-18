/**
 * Typed claim-graph construction for the nine lending credential kinds
 * (§6.2). Claims are lowered to RDF through `@rdfjs/wrapper` typed accessors
 * over the data-model terms — never string-built JSON-LD or hand-concatenated
 * Turtle. The matching SHACL shape is the authority on validity; issue()
 * refuses (fail-closed) any graph the shape rejects, so the guards here only
 * protect structural safety (IRI injection, date/dateTime lexicals) the RDF
 * layer itself cannot express.
 *
 * KNOWN GOTCHA (workspace memory): `@rdfjs/wrapper` `LiteralFrom.date` emits a
 * malformed `xsd:date` (dateTime lexical form). All `xsd:date` literals here go
 * through `LiteralFrom.datatypeTuple` with a validated `YYYY-MM-DD` lexical;
 * the shapes' `sh:datatype xsd:date` constraints catch any regression.
 */

import { FIBO, LEND, SCHEMA } from "@lending/data-model";
import type { DataFactory, DatasetCore, Term } from "@rdfjs/types";
import {
  LiteralFrom,
  NamedNodeFrom,
  RequiredAs,
  SetFrom,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import type { CredentialKind } from "./vocab.ts";
import { PROV_WAS_DERIVED_FROM, RDF_TYPE, XSD_DATE, XSD_DATE_TIME, XSD_DECIMAL } from "./vocab.ts";

/** A structured claim-construction failure (thrown BEFORE anything is signed). */
export class ClaimInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimInputError";
  }
}

/**
 * Reject values that cannot be an absolute IRI reference. `n3.Writer` does not
 * escape IRIs, so an unchecked value could break out of its `<...>` token when
 * the graph is serialised — every IRI entering a claim graph passes this gate.
 */
export function assertAbsoluteIri(value: string, label: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what an IRI reference must not contain
  if (/[\u0000-\u0020<>"{}|^`\\]/.test(value) || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    throw new ClaimInputError(
      `${label} is not an absolute IRI reference: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Validate an `xsd:date` lexical (`YYYY-MM-DD`). `Date.parse` alone is
 * insufficient: it silently normalises invalid calendar dates
 * (`2021-02-30` -> March 2nd), so the parsed components must round-trip.
 */
function assertDateLexical(value: string, label: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match !== null) {
    const [, year, month, day] = match;
    const parsed = new Date(`${value}T00:00:00Z`);
    if (
      !Number.isNaN(parsed.getTime()) &&
      parsed.getUTCFullYear() === Number(year) &&
      parsed.getUTCMonth() + 1 === Number(month) &&
      parsed.getUTCDate() === Number(day)
    ) {
      return value;
    }
  }
  throw new ClaimInputError(`${label} must be an xsd:date lexical (YYYY-MM-DD): ${value}`);
}

/** A USD amount as an `xsd:decimal` lexical with two fraction digits. */
function decimalLexical(value: number, label: string): string {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new ClaimInputError(`${label} must be a finite non-negative number: ${value}`);
  }
  return value.toFixed(2);
}

function assertSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new ClaimInputError(`${label} must be an integer: ${value}`);
  }
  return value;
}

/** An organization node (`lshape:OrganizationShape`). */
export interface OrganizationClaims {
  readonly name: string;
}

/** A US postal address (`lshape:PostalAddressShape`). */
export interface PostalAddressClaims {
  readonly streetAddress: string;
  readonly addressLocality: string;
  /** Two-letter US state code. */
  readonly addressRegion: string;
  /** US ZIP or ZIP+4. */
  readonly postalCode: string;
}

/** Identity VC subject (`lshape:IdentitySubjectShape`) — §6.2 row 1. */
export interface IdentityClaims {
  readonly kind: "identity-credential";
  readonly name: string;
  /** `xsd:date` lexical, `YYYY-MM-DD`. */
  readonly birthDate: string;
  readonly address: PostalAddressClaims;
}

/** Employment + income VC subject (`lshape:EmploymentIncomeSubjectShape`) — row 2. */
export interface EmploymentIncomeClaims {
  readonly kind: "employment-income-credential";
  readonly employer: OrganizationClaims;
  readonly jobTitle: string;
  /** `xsd:date` lexical, `YYYY-MM-DD`. */
  readonly startDate: string;
  /** Whole USD/month; the 4-digit ZK budget (0..9999). */
  readonly netMonthlyIncomeUsd: number;
}

/** One observed deposit stream of the cash-flow VC (`lshape:DepositStreamShape`). */
export interface DepositStreamClaims {
  readonly name: string;
  /** Net monthly deposit attributed to the stream (display USD). */
  readonly monthlyAmountUsd: number;
}

/** Bank cash-flow VC subject (`lshape:BankCashFlowSubjectShape`) — row 3, FDX-shaped. */
export interface BankCashFlowClaims {
  readonly kind: "bank-cashflow-credential";
  readonly provider: OrganizationClaims;
  /** Masked display identifier — exactly four digits. */
  readonly accountLast4: string;
  readonly depositStreams: readonly DepositStreamClaims[];
  /** The 2-digit ZK budget (0..99); the scene-2 NSF90 = 0 operand. */
  readonly nsf90Count: number;
  readonly averageDailyBalanceUsd: number;
  readonly observationMonths: number;
}

/** Cash-flow score VC subject (`lshape:CashFlowScoreSubjectShape`) — row 4. */
export interface CashFlowScoreClaims {
  readonly kind: "cashflow-score-credential";
  /** The 3-digit ZK budget (300..850). */
  readonly cashFlowScoreValue: number;
  /** Score model concept IRI; defaults to `lend:ScoreModel-CashFlowV1`. */
  readonly scoreModel?: string;
  /** The bank cash-flow credential pod resource this score derives from. */
  readonly derivedFrom: string;
}

/** Bureau credit-score VC subject (`lshape:CreditScoreSubjectShape`) — row 5. */
export interface CreditScoreClaims {
  readonly kind: "credit-score-credential";
  /** Bureau score points (300..850) — disclosed, never ZK-proved here. */
  readonly creditScoreValue: number;
  readonly tradelineCount: number;
  readonly creditHistoryMonths: number;
  /** Score model concept IRI; defaults to `lend:ScoreModel-BureauClassic`. */
  readonly scoreModel?: string;
}

/** Loan offer / closed-end disclosure VC subject (`lshape:LoanOfferSubjectShape`) — row 6. */
export interface LoanOfferClaims {
  readonly kind: "loan-offer-credential";
  /** Amount financed in USD. */
  readonly principalUsd: number;
  /** APR in percent (Reg Z §1026.18(e)), e.g. 32.9. */
  readonly aprPercent: number;
  /** Finance charge in USD (§1026.18(d)). */
  readonly financeChargeUsd: number;
  /** Total of payments in USD (§1026.18(h)); must equal payments x amount. */
  readonly totalOfPaymentsUsd: number;
  readonly loanTermMonths: number;
  readonly numberOfPayments: number;
  readonly paymentAmountUsd: number;
  /** Payments per year (12 = monthly). */
  readonly paymentsPerYear: number;
}

/** Disbursement receipt VC subject (`lshape:DisbursementReceiptSubjectShape`) — row 7. */
export interface DisbursementReceiptClaims {
  readonly kind: "disbursement-receipt-credential";
  readonly amountUsd: number;
  /** Initiation instant, ISO `xsd:dateTime` lexical. */
  readonly initiatedAt: string;
  /** Settlement instant, ISO `xsd:dateTime` lexical (after initiation). */
  readonly settledAt: string;
  /** Destination card, masked — exactly four digits. */
  readonly cardLast4: string;
  /** Optional IRI of the accepted loan offer this disbursement funds. */
  readonly fundsOffer?: string;
}

/** Repayment-history VC subject (`lshape:RepaymentHistorySubjectShape`) — row 8. */
export interface RepaymentHistoryClaims {
  readonly kind: "repayment-history-credential";
  /** The funded loan-offer pod resource the history reports on. */
  readonly servicedLoan: string;
  readonly onTimePaymentCount: number;
  readonly latePaymentCount: number;
  readonly scheduledPaymentCount: number;
  /** `xsd:date` lexicals, `YYYY-MM-DD`. */
  readonly periodStart: string;
  readonly periodEnd: string;
}

/**
 * ZK operand-anchor VC subject (`lshape:ZkOperandAnchorSubjectShape`): the
 * issuer-signed binding of a hidden field's deterministic sparq term
 * encoding. The next round's Tier-A prover layers the anchor<->proof
 * equality checks on top.
 */
export interface ZkOperandAnchorClaims {
  readonly kind: "zk-operand-anchor";
  /** The anchored field IRI — one of the three ZK scaled-unit fields. */
  readonly field: string;
  /** `0x`-prefixed lowercase hex field element (the circuit's `operand_enc`). */
  readonly operandEnc: string;
}

/** The typed claims union — discriminated by the credential kind. */
export type CredentialClaims =
  | IdentityClaims
  | EmploymentIncomeClaims
  | BankCashFlowClaims
  | CashFlowScoreClaims
  | CreditScoreClaims
  | LoanOfferClaims
  | DisbursementReceiptClaims
  | RepaymentHistoryClaims
  | ZkOperandAnchorClaims;

/** Strict ISO `xsd:dateTime` lexical for claim inputs. */
const DATE_TIME_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function assertDateTimeLexical(value: string, label: string): string {
  if (!DATE_TIME_INPUT.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ClaimInputError(`${label} must be an ISO xsd:dateTime lexical: ${value}`);
  }
  return value;
}

function assertLast4(value: string, label: string): string {
  if (!/^[0-9]{4}$/.test(value)) {
    throw new ClaimInputError(`${label} must be exactly four digits: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Base wrapper: typed multi-valued `rdf:type` plus single-valued setters. */
class GraphNode extends TermWrapper {
  get types(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, (term) => term.value, NamedNodeFrom.string);
  }

  setIri(predicate: string, iri: string, label: string): void {
    RequiredAs.object(this, predicate, assertAbsoluteIri(iri, label), NamedNodeFrom.string);
  }

  setString(predicate: string, value: string): void {
    RequiredAs.object(this, predicate, value, LiteralFrom.string);
  }

  setInteger(predicate: string, value: number, label: string): void {
    RequiredAs.object(this, predicate, assertSafeInteger(value, label), LiteralFrom.integer);
  }

  setTypedLiteral(predicate: string, datatype: string, lexical: string): void {
    RequiredAs.object(this, predicate, [datatype, lexical], LiteralFrom.datatypeTuple);
  }

  /** Mint a blank node, link it under `predicate`, and return it wrapped. */
  linkChild<T extends GraphNode>(
    predicate: string,
    ctor: new (term: Term, dataset: DatasetCore, factory: DataFactory) => T,
  ): T {
    const child = this.factory.blankNode();
    RequiredAs.object(this, predicate, child, TermFrom.itself);
    return new ctor(child, this.dataset, this.factory);
  }

  /** Link an EXISTING node under `predicate` (multi-valued children). */
  linkExisting(predicate: string, term: Term): void {
    RequiredAs.object(this, predicate, term, TermFrom.itself);
  }
}

class OrganizationNode extends GraphNode {
  writeClaims(claims: OrganizationClaims): void {
    this.types.add(SCHEMA.Organization);
    this.setString(SCHEMA.name, claims.name);
  }
}

class PostalAddressNode extends GraphNode {
  writeClaims(claims: PostalAddressClaims): void {
    this.types.add(SCHEMA.PostalAddress);
    this.setString(SCHEMA.streetAddress, claims.streetAddress);
    this.setString(SCHEMA.addressLocality, claims.addressLocality);
    this.setString(SCHEMA.addressRegion, claims.addressRegion);
    this.setString(SCHEMA.postalCode, claims.postalCode);
  }
}

class MonetaryAmountNode extends GraphNode {
  writeUsd(value: number, label: string): void {
    this.types.add(SCHEMA.MonetaryAmount);
    this.setTypedLiteral(SCHEMA.value, XSD_DECIMAL, decimalLexical(value, label));
    this.setString(SCHEMA.currency, "USD");
  }
}

class SubjectNode extends GraphNode {
  /** Live multi-valued `lend:hasDepositStream` (a cash-flow subject holds several). */
  get streams(): Set<GraphNode> {
    return SetFrom.subjectPredicate(
      this,
      LEND.hasDepositStream,
      (term) => new GraphNode(term as Term, this.dataset, this.factory),
      TermFrom.instance,
    );
  }
}

/**
 * Write the kind-specific subject claims for `subjectIri` into the dataset the
 * credential node lives in, plus any credential-node-level claims (the
 * derived-from provenance edges). Throws {@link ClaimInputError} on
 * structurally unsafe input; semantic validity is the SHACL shape's job at
 * issue().
 */
export function writeSubjectClaims(
  credentialNode: TermWrapper,
  subjectIri: string,
  claims: CredentialClaims,
): void {
  const factory = credentialNode.factory;
  const dataset = credentialNode.dataset;
  const credential = new GraphNode(credentialNode as Term, dataset, factory);
  const subject = new SubjectNode(
    factory.namedNode(assertAbsoluteIri(subjectIri, "subject WebID")),
    dataset,
    factory,
  );

  switch (claims.kind) {
    case "identity-credential": {
      subject.setString(SCHEMA.name, claims.name);
      subject.setTypedLiteral(
        SCHEMA.birthDate,
        XSD_DATE,
        assertDateLexical(claims.birthDate, "birthDate"),
      );
      subject.linkChild(SCHEMA.address, PostalAddressNode).writeClaims(claims.address);
      return;
    }
    case "employment-income-credential": {
      subject.linkChild(SCHEMA.worksFor, OrganizationNode).writeClaims(claims.employer);
      subject.setString(SCHEMA.jobTitle, claims.jobTitle);
      subject.setTypedLiteral(
        SCHEMA.startDate,
        XSD_DATE,
        assertDateLexical(claims.startDate, "startDate"),
      );
      subject.setInteger(
        LEND.netMonthlyIncomeUsd,
        claims.netMonthlyIncomeUsd,
        "netMonthlyIncomeUsd",
      );
      return;
    }
    case "bank-cashflow-credential": {
      const account = subject.linkChild(SCHEMA.owns, GraphNode);
      account.types.add(SCHEMA.DepositAccount);
      account.linkChild(SCHEMA.provider, OrganizationNode).writeClaims(claims.provider);
      account.setString(LEND.accountLast4, assertLast4(claims.accountLast4, "accountLast4"));
      const streams = subject.streams;
      for (const streamClaims of claims.depositStreams) {
        const stream = new GraphNode(factory.blankNode(), dataset, factory);
        stream.types.add(LEND.DepositStream);
        stream.setString(SCHEMA.name, streamClaims.name);
        stream
          .linkChild(SCHEMA.amount, MonetaryAmountNode)
          .writeUsd(streamClaims.monthlyAmountUsd, "depositStream.monthlyAmountUsd");
        streams.add(stream);
      }
      subject.setInteger(LEND.nsf90Count, claims.nsf90Count, "nsf90Count");
      subject
        .linkChild(LEND.hasAverageDailyBalance, MonetaryAmountNode)
        .writeUsd(claims.averageDailyBalanceUsd, "averageDailyBalanceUsd");
      subject.setInteger(LEND.observationMonths, claims.observationMonths, "observationMonths");
      return;
    }
    case "cashflow-score-credential": {
      subject.setInteger(LEND.cashFlowScoreValue, claims.cashFlowScoreValue, "cashFlowScoreValue");
      subject.setIri(
        LEND.scoreModel,
        claims.scoreModel ?? LEND.ScoreModel_CashFlowV1,
        "scoreModel",
      );
      credential.setIri(PROV_WAS_DERIVED_FROM, claims.derivedFrom, "derivedFrom");
      return;
    }
    case "credit-score-credential": {
      subject.setInteger(LEND.creditScoreValue, claims.creditScoreValue, "creditScoreValue");
      subject.setInteger(LEND.tradelineCount, claims.tradelineCount, "tradelineCount");
      subject.setInteger(
        LEND.creditHistoryMonths,
        claims.creditHistoryMonths,
        "creditHistoryMonths",
      );
      subject.setIri(
        LEND.scoreModel,
        claims.scoreModel ?? LEND.ScoreModel_BureauClassic,
        "scoreModel",
      );
      return;
    }
    case "loan-offer-credential": {
      const loan = subject.linkChild(LEND.hasLoanOffer, GraphNode);
      loan.types.add(FIBO.UnsecuredConsumerLoan);
      loan.types.add(FIBO.ClosedEndCredit);
      loan.types.add(SCHEMA.LoanOrCredit);
      loan
        .linkChild(FIBO.hasPrincipalAmount, MonetaryAmountNode)
        .writeUsd(claims.principalUsd, "principalUsd");
      if (
        !Number.isFinite(claims.aprPercent) ||
        claims.aprPercent < 0 ||
        claims.aprPercent >= 100
      ) {
        throw new ClaimInputError(`aprPercent must be in 0..<100: ${claims.aprPercent}`);
      }
      loan.setTypedLiteral(
        SCHEMA.annualPercentageRate,
        XSD_DECIMAL,
        decimalLexical(claims.aprPercent, "aprPercent"),
      );
      loan
        .linkChild(LEND.hasFinanceCharge, MonetaryAmountNode)
        .writeUsd(claims.financeChargeUsd, "financeChargeUsd");
      loan
        .linkChild(LEND.hasTotalOfPayments, MonetaryAmountNode)
        .writeUsd(claims.totalOfPaymentsUsd, "totalOfPaymentsUsd");
      loan.setInteger(LEND.loanTermMonths, claims.loanTermMonths, "loanTermMonths");
      const schedule = loan.linkChild(SCHEMA.loanRepaymentForm, GraphNode);
      schedule.types.add(SCHEMA.RepaymentSpecification);
      schedule.setInteger(SCHEMA.numberOfLoanPayments, claims.numberOfPayments, "numberOfPayments");
      schedule
        .linkChild(SCHEMA.loanPaymentAmount, MonetaryAmountNode)
        .writeUsd(claims.paymentAmountUsd, "paymentAmountUsd");
      schedule.setInteger(SCHEMA.loanPaymentFrequency, claims.paymentsPerYear, "paymentsPerYear");
      return;
    }
    case "disbursement-receipt-credential": {
      const transfer = subject.linkChild(LEND.hasDisbursement, GraphNode);
      transfer.types.add(SCHEMA.MoneyTransfer);
      transfer.linkChild(SCHEMA.amount, MonetaryAmountNode).writeUsd(claims.amountUsd, "amountUsd");
      transfer.setTypedLiteral(
        SCHEMA.startTime,
        XSD_DATE_TIME,
        assertDateTimeLexical(claims.initiatedAt, "initiatedAt"),
      );
      transfer.setTypedLiteral(
        SCHEMA.endTime,
        XSD_DATE_TIME,
        assertDateTimeLexical(claims.settledAt, "settledAt"),
      );
      transfer.setIri(LEND.paymentRail, LEND.PaymentRail_PushToCard, "paymentRail");
      transfer.setString(LEND.accountLast4, assertLast4(claims.cardLast4, "cardLast4"));
      if (claims.fundsOffer !== undefined) {
        credential.setIri(PROV_WAS_DERIVED_FROM, claims.fundsOffer, "fundsOffer");
      }
      return;
    }
    case "repayment-history-credential": {
      const history = subject.linkChild(FIBO.hasPaymentHistory, GraphNode);
      history.types.add(FIBO.PaymentHistory);
      history.setIri(LEND.servicedLoan, claims.servicedLoan, "servicedLoan");
      history.setInteger(LEND.onTimePaymentCount, claims.onTimePaymentCount, "onTimePaymentCount");
      history.setInteger(LEND.latePaymentCount, claims.latePaymentCount, "latePaymentCount");
      history.setInteger(
        LEND.scheduledPaymentCount,
        claims.scheduledPaymentCount,
        "scheduledPaymentCount",
      );
      history.setTypedLiteral(
        SCHEMA.startDate,
        XSD_DATE,
        assertDateLexical(claims.periodStart, "periodStart"),
      );
      history.setTypedLiteral(
        SCHEMA.endDate,
        XSD_DATE,
        assertDateLexical(claims.periodEnd, "periodEnd"),
      );
      return;
    }
    case "zk-operand-anchor": {
      subject.setIri(LEND.field, claims.field, "field");
      subject.setString(LEND.operandEnc, claims.operandEnc);
      return;
    }
    default: {
      const exhaustive: never = claims;
      throw new ClaimInputError(`unsupported claims kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export type { CredentialKind };
