/**
 * Scene 1 ("fill the vault") / scene 3 ("one decision, two models"): the
 * bureau's ONE issuer flow. Role-first framing, the PINNED demo-persona
 * values it signs (marked illustrative), what lands in the vault, and the
 * live issue panel. The layout-level ConceptDemoBanner + AppShell cover
 * every route already.
 */
import { StatCard } from "@jeswr/solid-showcase-kit";
import { PERSONA_VALUES } from "@lending/data-model";
import { IssuePanel } from "../../components/issue-panel";
import { CREDIT_SCORE_CREDENTIAL_PATH } from "../../lib/server/claims";
import { app } from "../../lib/walkthrough";

const PERSONA = PERSONA_VALUES[0];

export default function CreditScorePage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10 pb-28">
      <section>
        <p className="text-sm uppercase tracking-[0.2em]" style={{ color: "var(--primary)" }}>
          credit bureau
        </p>
        <h1 className="mt-2 font-semibold text-3xl tracking-tight">
          Credit Score VC — the traditional rail
        </h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          Scene 1 — fill the vault. This flow signs a <strong>W3C Verifiable Credential 2.0</strong>{" "}
          reporting the borrower's thin-file bureau facts and delivers it into their Data Vault pod
          through an authenticated Solid write. In scene 3 this is the "old rail" a bureau-only
          lender reads — and prices out or declines on. Modelled on the {app.modelledOn} role;
          simulated data only.
        </p>
      </section>

      <section aria-labelledby="credit-score-claims">
        <h2 className="font-semibold text-xl" id="credit-score-claims">
          What this flow attests
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            illustrative
            label="Bureau score"
            value={PERSONA === undefined ? "—" : String(PERSONA.creditScoreValue)}
          />
          <StatCard
            illustrative
            label="Open tradelines"
            value={PERSONA === undefined ? "—" : String(PERSONA.tradelineCount)}
          />
          <StatCard
            illustrative
            label="Credit history"
            value={PERSONA === undefined ? "—" : `${PERSONA.creditHistoryMonths} months`}
          />
        </div>
      </section>

      <section aria-labelledby="credit-score-lands">
        <h2 className="font-semibold text-xl" id="credit-score-lands">
          What lands in the vault
        </h2>
        <ul className="mt-4 grid list-none gap-3 p-0 text-sm">
          <li className="rounded-lg border border-border bg-card p-4">
            <strong>Signed credential</strong> — <code>credit-score-credential</code> at{" "}
            <code>{CREDIT_SCORE_CREDENTIAL_PATH}</code>, SHACL-validated before signing
            (eddsa-rdfc-2022), subject-bound to the authenticated borrower.
          </li>
          <li className="rounded-lg border border-border bg-card p-4">
            <strong>No ZK anchor</strong> — the bureau score is disclosed at presentation, never
            proved by threshold; this demo's ZK statements are scoped to income, cash-flow, and
            cash-flow-score fields only.
          </li>
          <li className="rounded-lg border border-border bg-card p-4">
            <strong>Bitstring status list</strong> — the bureau's own revocation list. Status
            signals revocation only.
          </li>
        </ul>
      </section>

      <IssuePanel />
    </div>
  );
}
