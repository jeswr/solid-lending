import { HonestyPanel, StatCard } from "@jeswr/solid-showcase-kit";
import { PERSONA_VALUES } from "@lending/data-model";
import {
  REG_B_ADVERSE_ACTION_TIMING,
  REG_B_STATUTORY_NOTICE,
} from "../../lib/server/adverse-action";
import { BUREAU_ONLY_THRESHOLDS, runBureauOnlyDecision } from "../../lib/server/underwriting";

export default function ApplicationPage() {
  const persona = PERSONA_VALUES[0];
  if (persona === undefined) throw new Error("no demo persona available");

  // Illustrative rendering of the SAME deterministic rule
  // `/api/application/submit` runs server-side over the granted, verified
  // credit-score credential — evaluated here directly against the pinned
  // persona figures for the walkthrough narrative. This desk never reads
  // cash-flow data, on this page or in the real route.
  const decision = runBureauOnlyDecision({
    creditHistoryMonths: persona.creditHistoryMonths,
    creditScoreValue: persona.creditScoreValue,
    evidence: [
      { fresh: true, kind: "credit-score", subjectBound: true, verified: true, verifyErrors: [] },
    ],
    tradelineCount: persona.tradelineCount,
  });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="font-semibold text-2xl">Scene 3 — The bank's counter-decision</h1>
        <p className="mt-2 text-muted-foreground">
          The same borrower who was just approved by cash-flow underwriting elsewhere in this
          walkthrough applies here too. The Personal Loan Desk decides on the bureau file alone —
          honestly, on the record, with the adverse-action reasons Regulation B requires.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          detail={`${persona.tradelineCount} tradelines, ${persona.creditHistoryMonths} months`}
          label="Bureau score"
          value={persona.creditScoreValue}
        />
        <StatCard
          detail={`>= ${BUREAU_ONLY_THRESHOLDS.minCreditScore}`}
          label="Approval floor"
          value="near-prime"
        />
        <StatCard illustrative label="Requested loan" value="$2,000 / 18 mo" />
      </section>

      <section className="rounded-lg border border-border p-4">
        <h2 className="font-medium">
          {decision.outcome === "approve"
            ? "Approved"
            : decision.outcome === "decline"
              ? "Declined"
              : "Referred"}
        </h2>
        {decision.findings !== undefined && (
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {decision.findings.map((finding) => (
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
        )}
      </section>

      {decision.outcome === "decline" && (
        <section className="rounded-lg border border-border p-4">
          <h2 className="font-medium">Reg B adverse-action notice</h2>
          <p className="mt-1 text-muted-foreground text-sm">{REG_B_ADVERSE_ACTION_TIMING}</p>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {decision.adverseActionReasons.map((reason) => (
              <li key={reason}>Principal reason: {reason}</li>
            ))}
          </ul>
          <p className="mt-3 text-muted-foreground text-sm">{REG_B_STATUTORY_NOTICE}</p>
        </section>
      )}

      <section className="rounded-lg border border-border p-4">
        <h2 className="font-medium">The contrast, made honest</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          This desk's own decision never consulted a single deposit, NSF event, or cash-flow score —
          that evidence belongs to a different lender's underwriting, elsewhere in this walkthrough,
          where the SAME borrower is approved. Neither outcome is staged after the fact: both run
          the same evidence through each lender's own transparent, threshold-based rule.
        </p>
      </section>

      <HonestyPanel
        real={
          <ul className="list-disc pl-5">
            <li>
              <code>/api/application/submit</code> requires the borrower&apos;s own authenticated
              session, reads ONLY the granted credit-score credential over this lender&apos;s REAL
              service identity (client_credentials + DPoP), and runs vc-kit&apos;s full fail-closed{" "}
              <code>verifyCredential</code> gate — signature, trusted issuer, validity window,
              Bitstring status, and shape — before it becomes evidence.
            </li>
            <li>
              A non-granted or revoked service identity is denied by the pod itself (401/403); an
              unverified or tampered credential downgrades the run to &quot;refer&quot;, never
              &quot;decline&quot; or &quot;approve&quot;.
            </li>
            <li>
              On decline, the Reg B adverse-action notice is written into the pod; on approval, the
              Reg Z closed-end disclosure is delivered instead — same fail-closed pod-write boundary
              either way.
            </li>
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            <li>
              This page renders the SAME deterministic rule over Maya&apos;s pinned demo figures for
              the walkthrough narrative — no pod is read here.
            </li>
            <li>
              Every dollar figure, rate, and decision is illustrative, not a real offer or denial of
              credit.
            </li>
          </ul>
        }
      />
    </main>
  );
}
