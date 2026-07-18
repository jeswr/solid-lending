import { HonestyPanel, IllustrativeFigure, StatCard } from "@jeswr/solid-showcase-kit";
import { PERSONA_VALUES } from "@lending/data-model";
import {
  DEMO_CARD_LAST4,
  MAX_SETTLEMENT_MINUTES,
  runSimulatedPayout,
  SETTLEMENT_MINUTES,
} from "../lib/server/payout";

export default function HomePage() {
  const persona = PERSONA_VALUES[0];
  if (persona === undefined) throw new Error("no demo persona available");

  // Illustrative rendering of the SAME deterministic payout `/api/payout`
  // runs server-side once it verifies the granted loan offer — evaluated
  // here against a fixed instant for the walkthrough narrative only.
  const now = new Date("2026-07-16T14:02:00Z");
  const payout = runSimulatedPayout(now);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="font-semibold text-2xl">Scene 4 — Funded in minutes</h1>
        <p className="mt-2 text-muted-foreground">
          Instant Payout (modelled on Mastercard Send) receives a single-use disbursement
          instruction — loan proceeds to Maya&apos;s debit card, nothing else. The rail sees the
          payment instruction, not her application, her credentials, or her history.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          detail={`push-to-card, ≤${MAX_SETTLEMENT_MINUTES} min rail`}
          label="This rail"
          value={`${SETTLEMENT_MINUTES} min`}
        />
        <StatCard detail="a traditional bank, worst case" label="Old rail" value="up to 7 days" />
        <StatCard illustrative label="Disbursed amount" value={`$${persona.principalUsd}`} />
      </section>

      <section className="rounded-lg border border-border p-4">
        <h3 className="font-medium">Illustrative disbursement receipt</h3>
        <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Amount</dt>
          <dd>
            $<IllustrativeFigure>{persona.principalUsd}</IllustrativeFigure>
          </dd>
          <dt className="text-muted-foreground">Initiated</dt>
          <dd>{payout.initiatedAt.toISOString()}</dd>
          <dt className="text-muted-foreground">Settled</dt>
          <dd>{payout.settledAt.toISOString()}</dd>
          <dt className="text-muted-foreground">Rail</dt>
          <dd>Push-to-card (Mastercard Send-modelled)</dd>
          <dt className="text-muted-foreground">Destination card</dt>
          <dd>•••• {DEMO_CARD_LAST4}</dd>
        </dl>
      </section>

      <HonestyPanel
        defaultOpen
        real={
          <ul className="list-disc pl-5">
            <li>
              <code>/api/payout</code> requires the borrower&apos;s own authenticated session, reads
              the granted loan-offer document over this rail&apos;s REAL service identity
              (client_credentials + DPoP), and runs vc-kit&apos;s full fail-closed{" "}
              <code>verifyCredential</code> gate — signature, trusted issuer, validity window,
              Bitstring status, and shape — plus a subject-binding and offer-freshness check, before
              anything is disbursed.
            </li>
            <li>
              A non-granted or revoked service identity is denied by the pod itself (401/403); a
              missing, unverified, unbound, or expired offer refuses the payout outright — no
              receipt is ever written.
            </li>
            <li>
              On a verified offer, the Disbursement Receipt is a REAL <code>eddsa-rdfc-2022</code>
              -signed credential, checked against its Bitstring status list, and strict-created into
              the pod — a repeat call against an already-funded loan is refused (409), never a
              second payout.
            </li>
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            <li>
              The push-to-card payment itself is scripted demo content — deterministic, timestamped,
              no money moves and no real card is contacted.
            </li>
            <li>This page renders illustrative figures for the walkthrough narrative only.</li>
          </ul>
        }
      />
    </main>
  );
}
