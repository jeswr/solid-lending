/**
 * The shared branded issuer-flow page (server component): role-first
 * framing, the PINNED demo-persona values the flow signs (marked
 * illustrative), what lands in the vault (credential + operand anchor +
 * status list), and the live issue panel. The layout-level
 * ConceptDemoBanner + AppShell cover every route already.
 */
import { StatCard } from "@jeswr/solid-showcase-kit";
import type { IssuerFlowId } from "../lib/server/config";
import { ISSUER_FLOWS } from "../lib/server/flows";
import { IssuePanel } from "./issue-panel";

const USD = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});

interface ClaimRow {
  readonly label: string;
  readonly value: string;
  /** Money/score/count figures carry the illustrative-figure qualifier. */
  readonly illustrative?: boolean;
}

/** A placeholder pod base for display only — nothing here is ever written or issued. */
const DISPLAY_POD_BASE = "https://borrower.pod.example/";

/** The pinned demo values, lowered to display rows (demo persona only — no real PII). */
function claimRows(flow: IssuerFlowId): ClaimRow[] {
  const claims = ISSUER_FLOWS[flow].claims(DISPLAY_POD_BASE);
  switch (claims.kind) {
    case "identity-credential":
      return [
        { label: "Name", value: claims.name },
        { label: "Date of birth", value: claims.birthDate },
        {
          label: "Address",
          value: `${claims.address.streetAddress}, ${claims.address.addressLocality}, ${claims.address.addressRegion} ${claims.address.postalCode}`,
        },
      ];
    case "employment-income-credential":
      return [
        { label: "Employer", value: claims.employer.name },
        { label: "Job title", value: claims.jobTitle },
        { label: "Employed since", value: claims.startDate },
        {
          illustrative: true,
          label: "Net monthly income",
          value: `${USD.format(claims.netMonthlyIncomeUsd)}/mo`,
        },
      ];
    case "bank-cashflow-credential":
      return [
        { label: "Bank", value: claims.provider.name },
        { label: "Account", value: `•••• ${claims.accountLast4}` },
        ...claims.depositStreams.map((stream) => ({
          illustrative: true,
          label: stream.name,
          value: `${USD.format(stream.monthlyAmountUsd)}/mo`,
        })),
        { illustrative: true, label: "NSF events (90 days)", value: String(claims.nsf90Count) },
        {
          illustrative: true,
          label: "Average daily balance",
          value: USD.format(claims.averageDailyBalanceUsd),
        },
      ];
    case "cashflow-score-credential":
      return [
        { illustrative: true, label: "Cash-flow score", value: String(claims.cashFlowScoreValue) },
        { label: "Score model", value: "consortium cash-flow score, v1" },
      ];
    default:
      return [];
  }
}

export function FlowPage({ flow }: { flow: IssuerFlowId }) {
  const definition = ISSUER_FLOWS[flow];
  const rows = claimRows(flow);
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10 pb-28"
      data-flow-page={flow}
    >
      <section>
        <p className="text-sm uppercase tracking-[0.2em]" style={{ color: "var(--primary)" }}>
          {definition.role}
        </p>
        <h1 className="mt-2 font-semibold text-3xl tracking-tight">{definition.label}</h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          Scene 1 — fill the vault. This issuer flow signs a{" "}
          <strong>W3C Verifiable Credential 2.0</strong> for the borrower and delivers it into their
          Data Vault pod through an authenticated Solid write — issued once, re-used with every
          lender the borrower will ever shop instead of re-collecting documents. Modelled on the{" "}
          {definition.modelledOn} role; simulated data only.
        </p>
      </section>

      <section aria-labelledby={`${flow}-claims`}>
        <h2 className="font-semibold text-xl" id={`${flow}-claims`}>
          What this flow attests
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((row) => (
            <StatCard
              illustrative={row.illustrative}
              key={row.label}
              label={row.label}
              value={row.value}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby={`${flow}-lands`}>
        <h2 className="font-semibold text-xl" id={`${flow}-lands`}>
          What lands in the vault
        </h2>
        <ul className="mt-4 grid list-none gap-3 p-0 text-sm">
          <li className="rounded-lg border border-border bg-card p-4">
            <strong>Signed credential</strong> — <code>{definition.kind}</code> at{" "}
            <code>{definition.credentialPath}</code>, SHACL-validated before signing
            (eddsa-rdfc-2022), subject-bound to the authenticated borrower.
          </li>
          {definition.anchor === undefined ? (
            <li className="rounded-lg border border-border bg-card p-4">
              <strong>No ZK anchor</strong> — identity is disclosed at presentation, never proved by
              threshold; ZK statements are scoped to income, cash-flow, and score fields only.
            </li>
          ) : (
            <li className="rounded-lg border border-border bg-card p-4">
              <strong>ZK operand anchor</strong> — the issuer-signed term encoding of the hidden
              value at <code>{definition.anchor.path}</code> (borrower-only). A bare filter proof is
              forgeable; lenders verify proofs against this anchor.
            </li>
          )}
          <li className="rounded-lg border border-border bg-card p-4">
            <strong>Bitstring status list</strong> — one revocation list per issuer flow. Status
            signals revocation only.
          </li>
        </ul>
      </section>

      <IssuePanel flow={flow} />
    </div>
  );
}
