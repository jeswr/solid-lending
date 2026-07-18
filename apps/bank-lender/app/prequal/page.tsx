import {
  CredentialCard,
  HonestyPanel,
  IllustrativeFigure,
  StatCard,
} from "@jeswr/solid-showcase-kit";
import { PREQUALIFICATION_STATEMENTS } from "@lending/vc-kit";
import { ZK_PREQUAL_THRESHOLDS } from "@lending/data-model";

const STATEMENT_LABELS: Record<keyof typeof PREQUALIFICATION_STATEMENTS, string> = {
  cashFlowScoreValue: "Cash-flow score",
  netMonthlyIncomeUsd: "Net monthly income",
  nsf90Count: "NSF events (90 days)",
};

export default function PrequalPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="font-semibold text-2xl">Scene 2 — Ask the bank for a pre-qual</h1>
        <p className="mt-2 text-muted-foreground">
          Maya proves the SAME three predicates over her vault&apos;s credentials to this bank that
          she proves to the fintech lender — a single zero-knowledge presentation. The Personal Loan
          Desk learns TRUE or FALSE for each statement — never the underlying income, score, or
          bank-transaction values, and no PII or identifiers cross the wire.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        {(
          Object.keys(PREQUALIFICATION_STATEMENTS) as (keyof typeof PREQUALIFICATION_STATEMENTS)[]
        ).map((field) => {
          const statement = PREQUALIFICATION_STATEMENTS[field];
          const bound = statement.op === "ge" ? `≥ ${statement.bound}` : `= ${statement.bound}`;
          return (
            <StatCard
              key={field}
              detail={statement.field}
              label={STATEMENT_LABELS[field]}
              value={bound}
            />
          );
        })}
      </section>

      <section>
        <h2 className="font-medium text-lg">The nine fail-closed verification gates</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Every presented statement runs through structural checks, a single-use nonce burn, the
          transcript-bound challenge, the statement match, the issuer-signed operand-anchor VC
          (signature + trusted-issuer + validity window + Bitstring status), the holder binding, the
          anchor-field match, the anchor-operand equality (the forgery-resistance gate), and the
          UltraHonk cryptographic proof itself. ANY failure rejects the whole presentation — a bad
          leg sinks the shared nonce, so a failed attempt can never retry.
        </p>
      </section>

      <CredentialCard
        issuer="the bank's own single-use challenge"
        status="pending"
        title="Pre-qualification presentation"
      >
        <p className="text-sm">
          Threshold pinning:{" "}
          <IllustrativeFigure>
            income ≥ ${ZK_PREQUAL_THRESHOLDS.netMonthlyIncomeUsd}/mo, cash-flow score ≥{" "}
            {ZK_PREQUAL_THRESHOLDS.cashFlowScoreValue}, NSF₉₀ = {ZK_PREQUAL_THRESHOLDS.nsf90Count}
          </IllustrativeFigure>
        </p>
      </CredentialCard>

      <p className="text-muted-foreground text-sm">
        Clearing this shopping-stage proof is not a guarantee: once Maya actually applies (scene 3),
        the Personal Loan Desk's real decision reads only her bureau credit-score credential — the
        SAME thresholds proven here in zero knowledge are never disclosed to it, and a bureau pull
        can still tell a different story than the pre-qual predicates did.
      </p>

      <HonestyPanel
        real={
          <ul className="list-disc pl-5">
            <li>
              The verify route (<code>/api/prequal/verify</code>) runs the full fail-closed Tier-A
              gate chain against a genuine UltraHonk proof and a genuine issuer-signed
              operand-anchor credential — never a mocked or bypassed check.
            </li>
            <li>
              The challenge route requires a real DPoP-bound Solid-OIDC session; anonymous callers
              get 401, and an unconfigured issuer allowlist fails closed with 503.
            </li>
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            <li>
              This standalone page&apos;s demo-proof route signs anchors with a self-hosted demo
              issuer over Maya&apos;s pinned persona values (never a live pod read) — see the
              honesty note in <code>lib/server/demo-issuer.ts</code>. In the full deployment the
              anchors come from the borrower&apos;s own vault, issued once by the Verification
              Center.
            </li>
          </ul>
        }
      />
    </main>
  );
}
