import { HonestyPanel } from "@jeswr/solid-showcase-kit";
import Link from "next/link";
import { ISSUER_FLOW_IDS } from "../lib/server/config";
import { ISSUER_FLOWS } from "../lib/server/flows";
import { app } from "../lib/walkthrough";

const FLOW_HREF: Record<(typeof ISSUER_FLOW_IDS)[number], string> = {
  cashflow: "/cashflow",
  identity: "/identity",
  income: "/income",
  score: "/score",
};

export default function HomePage() {
  const honesty = app.honesty ?? { real: [], simulated: [] };
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 pb-28">
      <section>
        <p className="mb-3 font-semibold text-muted-foreground text-sm uppercase tracking-[0.2em]">
          Small-Dollar Lending — scene 1: fill the vault
        </p>
        <h1 className="font-semibold text-4xl text-foreground tracking-tight sm:text-5xl">
          {app.appName}
        </h1>
        <p className="mt-5 max-w-3xl text-lg text-muted-foreground">
          Four branded issuer flows — modelled on {app.modelledOn} — sign identity,
          employment-and-income, bank cash-flow, and cash-flow-score verifiable credentials straight
          into the borrower's Data Vault pod. Verified once, re-used with every lender instead of
          re-collected per application.
        </p>
      </section>

      <section aria-labelledby="issuer-flows">
        <h2 className="font-semibold text-foreground text-xl" id="issuer-flows">
          Issuer flows
        </h2>
        <ul className="mt-4 grid list-none gap-4 p-0 md:grid-cols-2 lg:grid-cols-4">
          {ISSUER_FLOW_IDS.map((id) => {
            const definition = ISSUER_FLOWS[id];
            return (
              <li key={id}>
                <Link
                  className="block h-full rounded-lg border border-border bg-card p-5 no-underline transition-shadow hover:shadow-md"
                  href={FLOW_HREF[id]}
                >
                  <p
                    className="text-xs uppercase tracking-[0.15em]"
                    style={{ color: "var(--primary)" }}
                  >
                    {definition.role}
                  </p>
                  <p className="mt-2 font-semibold text-card-foreground">
                    modelled on {definition.modelledOn}
                  </p>
                  <p className="mt-3 text-muted-foreground text-sm">
                    Issues a <code>{definition.kind}</code>
                    {definition.anchor !== undefined && " plus its ZK operand anchor"} into the
                    borrower's pod, with a per-flow Bitstring revocation list.
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <HonestyPanel
        defaultOpen
        real={
          <ul className="list-disc pl-5">
            {honesty.real.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            {honesty.simulated.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        }
      />
    </main>
  );
}
