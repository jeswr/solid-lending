/**
 * Wrapper gates: every builder produces a document its shape accepts and its
 * typed accessors read back; the cheap invariants (ZK digit budgets,
 * controlled vocabularies, masked identifiers) throw at the setter; and the
 * serialize path is fail-closed (SPARQL arithmetic + closed-shape checks
 * refuse non-conforming documents before any bytes leave the process).
 */
import { expect, test } from "vitest";
import {
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
  DPV,
  LEND,
  resourceToTurtle,
  ShapeViolationError,
  validate,
} from "../src/index.ts";
import {
  cashFlowInit,
  cashFlowScoreInit,
  creditScoreInit,
  disbursementInit,
  employmentInit,
  envelope,
  identityInit,
  loanOfferInit,
  maya,
  NOW,
  repaymentInit,
  WEBID,
} from "./support.ts";

test("identity credential: build, serialise, read back", async () => {
  const credential = buildIdentityCredential(identityInit());
  const turtle = await resourceToTurtle(credential);
  expect(turtle).toContain("Maya Torres");
  const subject = credential.credentialSubject;
  expect(subject.personName).toBe(maya().name);
  expect(subject.address.addressRegion).toBe("OH");
  const report = await validate(turtle, {
    expect: "identity-credential",
    focusNode: credential.value,
  });
  expect(report.conforms).toBe(true);
});

test("employment credential: ZK budget enforced at the setter", () => {
  const credential = buildEmploymentIncomeCredential(employmentInit());
  expect(credential.credentialSubject.netMonthlyIncomeUsd).toBe(maya().netMonthlyIncomeUsd);
  expect(() => {
    credential.credentialSubject.netMonthlyIncomeUsd = 10_000;
  }).toThrow(/4-digit ZK budget/);
  expect(() => {
    credential.credentialSubject.netMonthlyIncomeUsd = -1;
  }).toThrow(/4-digit ZK budget/);
});

test("employment credential: a disclosed copy of income breaks the closed subject shape", async () => {
  const credential = buildEmploymentIncomeCredential(employmentInit());
  // Smuggle a disclosed income derivative onto the subject (defeats ZK hiding).
  credential.credentialSubject.dataset.add(
    credential.credentialSubject.factory.quad(
      credential.credentialSubject.factory.namedNode(WEBID),
      credential.credentialSubject.factory.namedNode("https://schema.org/baseSalary"),
      credential.credentialSubject.factory.literal("2860"),
    ),
  );
  await expect(resourceToTurtle(credential)).rejects.toThrow(ShapeViolationError);
});

test("bank cash-flow credential: streams, NSF budget, masked account", async () => {
  const credential = buildBankCashFlowCredential(cashFlowInit());
  const subject = credential.credentialSubject;
  expect(subject.nsf90Count).toBe(0);
  expect(subject.account.accountLast4).toBe("4821");
  const streams = [...subject.depositStreams];
  expect(streams).toHaveLength(2);
  const sum = streams.reduce((total, stream) => total + stream.monthlyAmount.amountValue, 0);
  expect(sum).toBe(maya().netMonthlyIncomeUsd);
  expect(() => {
    subject.nsf90Count = 120;
  }).toThrow(/2-digit ZK budget/);
  expect(() => {
    subject.account.accountLast4 = "12345";
  }).toThrow(/four digits/);
  const turtle = await resourceToTurtle(credential);
  const report = await validate(turtle, {
    expect: "bank-cashflow-credential",
    focusNode: credential.value,
  });
  expect(report.conforms).toBe(true);
});

test("cash-flow score credential: budget + required derived-from", async () => {
  const credential = buildCashFlowScoreCredential(cashFlowScoreInit());
  expect(credential.credentialSubject.cashFlowScoreValue).toBe(720);
  expect(credential.derivedFromIri).toContain("bank-cash-flow");
  expect(() => {
    credential.credentialSubject.cashFlowScoreValue = 299;
  }).toThrow(/3-digit ZK budget/);
  await expect(resourceToTurtle(credential)).resolves.toContain("wasDerivedFrom");
});

test("credit score credential: bureau range + thin-file facts", async () => {
  const credential = buildCreditScoreCredential(creditScoreInit());
  const subject = credential.credentialSubject;
  expect(subject.creditScoreValue).toBe(612);
  expect(subject.tradelineCount).toBe(2);
  expect(subject.creditHistoryMonths).toBe(14);
  expect(() => {
    subject.creditScoreValue = 900;
  }).toThrow(/300\.\.850/);
  await expect(resourceToTurtle(credential)).resolves.toContain("612");
});

test("loan offer credential: disclosure fields read back and validate", async () => {
  const credential = buildLoanOfferCredential(loanOfferInit());
  const loan = credential.credentialSubject.loanOffer;
  expect(loan.aprPercent).toBe(32.9);
  expect(loan.principalAmount.amountValue).toBe(2000);
  expect(loan.financeCharge.amountValue).toBe(560.68);
  expect(loan.totalOfPayments.amountValue).toBe(2560.68);
  const schedule = loan.repaymentSpecification;
  expect(schedule.numberOfLoanPayments).toBe(18);
  expect(schedule.loanPaymentAmount.amountValue).toBe(142.26);
  expect(schedule.loanPaymentFrequency).toBe(12);
  const turtle = await resourceToTurtle(credential);
  const report = await validate(turtle, {
    expect: "loan-offer-credential",
    focusNode: credential.value,
  });
  expect(report.conforms).toBe(true);
});

test("loan offer credential: broken disclosure arithmetic is refused (SPARQL constraint)", async () => {
  const credential = buildLoanOfferCredential({
    ...loanOfferInit(),
    // Understates the cost of credit: total != 18 x 142.26.
    totalOfPaymentsUsd: 2400,
    financeChargeUsd: 400,
  });
  await expect(resourceToTurtle(credential)).rejects.toThrow(/disclosure arithmetic/);
});

test("disbursement receipt: settle-after-initiate is shape-enforced", async () => {
  const good = buildDisbursementReceiptCredential(disbursementInit());
  const transfer = good.credentialSubject.disbursement;
  expect(transfer.endTime.getTime() - transfer.startTime.getTime()).toBe(22 * 60 * 1000);
  expect(transfer.paymentRail).toBe(LEND.PaymentRail_PushToCard);
  await expect(resourceToTurtle(good)).resolves.toContain("MoneyTransfer");

  const bad = buildDisbursementReceiptCredential({
    ...disbursementInit(),
    settledAt: new Date("2026-06-07T11:00:00Z"),
    initiatedAt: new Date("2026-06-07T12:00:00Z"),
  });
  await expect(resourceToTurtle(bad)).rejects.toThrow(ShapeViolationError);
});

test("repayment history: counts reconcile against the schedule (SPARQL constraint)", async () => {
  const good = buildRepaymentHistoryCredential(repaymentInit());
  expect(good.credentialSubject.paymentHistory.onTimePaymentCount).toBe(1);
  await expect(resourceToTurtle(good)).resolves.toContain("PaymentHistory");

  const bad = buildRepaymentHistoryCredential({
    ...repaymentInit(),
    onTimePaymentCount: 17,
    latePaymentCount: 2,
    scheduledPaymentCount: 18,
  });
  await expect(resourceToTurtle(bad)).rejects.toThrow(/must not exceed scheduledPaymentCount/);
});

test("consent receipt: controlled status vocabulary", async () => {
  const receipt = buildConsentReceipt({
    iri: "https://maya.pod.example/lending/receipts/1",
    dataSubject: WEBID,
    dataController: "https://fintech-lender.example/orgs/installment-lending#id",
    target: "https://maya.pod.example/lending/credentials/bank-cash-flow",
    consentStatus: DPV.ConsentGiven,
    issued: NOW,
  });
  await expect(resourceToTurtle(receipt)).resolves.toContain("ConsentReceipt");
  expect(() => {
    receipt.consentStatus = "https://w3id.org/dpv#NotAStatus";
  }).toThrow(/consentStatus/);
});

test("zk operand anchor: only the three ZK fields are anchorable", async () => {
  const anchor = buildZkOperandAnchor({
    ...envelope("https://maya.pod.example/lending/credentials/anchors/income", {
      validUntil: undefined,
    }),
    field: LEND.netMonthlyIncomeUsd,
    operandEnc: "0x07b66a6df9e52198d3d823f29c5030fd9721dafcf31b7a44da67a0f21d3710b0",
  });
  await expect(resourceToTurtle(anchor)).resolves.toContain("operandEnc");
  expect(() => {
    // The bureau score is deliberately NOT ZK-anchorable in this demo.
    anchor.credentialSubject.fieldIri = LEND.creditScoreValue;
  }).toThrow(/fieldIri/);
  expect(() => {
    anchor.credentialSubject.operandEnc = "0xNOTHEX";
  }).toThrow(/hex field element/);
});
