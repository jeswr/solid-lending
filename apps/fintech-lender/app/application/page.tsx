import { HonestyPanel, IllustrativeFigure, StatCard } from "@jeswr/solid-showcase-kit";
import { PERSONA_VALUES } from "@lending/data-model";
import type { RailDecision } from "../../lib/server/underwriting";
import { runTwoModelDecision } from "../../lib/server/underwriting";

function railCard(title: string, rail: RailDecision | undefined) {
  if (rail === undefined) return null;
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-1 font-semibold text-lg uppercase tracking-wide">
        {rail.outcome === "approve" ? "Approved" : "Declined"}
      </p>
      {rail.offer !== undefined && (
        <p className="mt-1 text-sm">
          $
          <IllustrativeFigure>
            {rail.offer.principalUsd} over {rail.offer.loanTermMonths} months at{" "}
            {rail.offer.aprPercent}% APR — ${rail.offer.paymentAmountUsd}/mo
          </IllustrativeFigure>
        </p>
      )}
      {rail.adverseActionReasons.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-muted-foreground text-sm">
          {rail.adverseActionReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      <ul className="mt-3 flex flex-col gap-1 text-sm">
        {rail.findings.map((finding) => (
          <li key={finding.code} className="flex justify-between gap-2">
            <span>{finding.rule}</span>
            {/* WCAG AA text contrast needs >=4.5:1; emerald-600 on this
                background measures ~3.5:1, so use emerald-700. */}
            <span className={finding.pass ? "text-emerald-700" : "text-red-600"}>
              {finding.observed} ({finding.threshold})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ApplicationPage() {
  const persona = PERSONA_VALUES[0];
  if (persona === undefined) throw new Error("no demo persona available");

  // Illustrative rendering of the SAME deterministic rules `/api/application/submit`
  // runs server-side over the granted, verified pod data — evaluated here directly
  // against the pinned persona figures for the walkthrough narrative.
  const decision = runTwoModelDecision({
    cashFlowScoreValue: persona.cashFlowScoreValue,
    creditHistoryMonths: persona.creditHistoryMonths,
    creditScoreValue: persona.creditScoreValue,
    evidence: (
      ["identity", "income", "bank-cash-flow", "cash-flow-score", "credit-score"] as const
    ).map((kind) => ({ fresh: true, kind, subjectBound: true, verified: true, verifyErrors: [] })),
    netMonthlyIncomeUsd: persona.netMonthlyIncomeUsd,
    nsf90Count: persona.nsf90Count,
    tradelineCount: persona.tradelineCount,
  });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="font-semibold text-2xl">Scene 3 — One decision, two models</h1>
        <p className="mt-2 text-muted-foreground">
          The same borrower, the same data, decisioned two ways on screen: the bureau-only model
          prices her out; bureau plus cash flow approves her in seconds.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          detail="thin file, 2 tradelines, 14 months"
          label="Bureau score"
          value={persona.creditScoreValue}
        />
        <StatCard
          detail={`$${persona.netMonthlyIncomeUsd}/mo, 0 NSF events`}
          label="Cash-flow score"
          value={persona.cashFlowScoreValue}
        />
        <StatCard illustrative label="Requested loan" value="$2,000 / 18 mo" />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {railCard("Bureau-only model (the old rail)", decision.bureauOnly)}
        {railCard("Bureau + cash-flow model (this lender)", decision.cashFlowPlus)}
      </section>

      <HonestyPanel
        real={
          <ul className="list-disc pl-5">
            <li>
              <code>/api/application/submit</code> requires the borrower&apos;s own authenticated
              session, reads the granted credentials over this lender&apos;s REAL service identity
              (client_credentials + DPoP), and runs vc-kit&apos;s full fail-closed{" "}
              <code>verifyCredential</code> gate — signature, trusted issuer, validity window,
              Bitstring status, and shape — on every credential before it becomes evidence.
            </li>
            <li>
              A non-granted or revoked service identity is denied by the pod itself (401/403); an
              unverified or tampered credential downgrades the run to &quot;refer&quot;, never
              &quot;approve&quot;.
            </li>
            <li>
              On approval, the Reg Z closed-end disclosure (APR, finance charge, amount financed,
              payment schedule) is delivered into the pod before consummation.
            </li>
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            <li>
              This page renders the SAME deterministic rules over Maya&apos;s pinned demo figures
              for the walkthrough narrative — no pod is read here.
            </li>
            <li>
              Every dollar figure, rate, and decision is illustrative, not a real offer of credit.
            </li>
          </ul>
        }
      />
    </main>
  );
}
