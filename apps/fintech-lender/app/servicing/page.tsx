import { HonestyPanel, StatCard } from "@jeswr/solid-showcase-kit";
import { PERSONA_VALUES } from "@lending/data-model";
import {
  PAYDAY_PAYMENT_PROVISIONS_RULE,
  REG_E_COMPULSORY_USE_RULE,
} from "../../lib/server/servicing";

export default function ServicingPage() {
  const persona = PERSONA_VALUES[0];
  if (persona === undefined) throw new Error("no demo persona available");

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="font-semibold text-2xl">Scene 5 — Repay, build, stay in control</h1>
        <p className="mt-2 text-muted-foreground">
          Repayment is an inspectable, optional grant — not a buried mandate — and every on-time
          payment builds toward a repayment-history credential the bureau can receive.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Monthly payment" value={`$${persona.paymentAmountUsd}`} />
        <StatCard label="Loan term" value={`${persona.loanTermMonths} months`} />
        <StatCard label="Autopay" value="Optional" />
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="font-medium">Payment-protection rails</h2>
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          <li>{PAYDAY_PAYMENT_PROVISIONS_RULE}</li>
          <li>{REG_E_COMPULSORY_USE_RULE}</li>
        </ul>
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="font-medium">The graduation beat</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          {persona.onTimePaymentCount} on-time payment(s) so far, {persona.latePaymentCount} late —
          furnished as a repayment-history credential toward the Credit File, thickening a thin file
          into a credit history.
        </p>
      </section>

      <HonestyPanel
        real={
          <ul className="list-disc pl-5">
            <li>
              <code>/api/servicing/repayment-grant</code> and{" "}
              <code>/api/servicing/furnish-history</code> require the borrower&apos;s own
              authenticated session and read the delivered loan offer over this lender&apos;s REAL
              service identity — no anonymous fallback.
            </li>
            <li>
              Furnishing writes a shape-validated repayment-history document into the pod, linked to
              the actual delivered offer resource.
            </li>
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            <li>
              The on-time/late payment counts shown here are the walkthrough&apos;s scripted demo
              figures — no real payments were collected.
            </li>
          </ul>
        }
      />
    </main>
  );
}
