import { HonestyPanel } from "@jeswr/solid-showcase-kit";
import Link from "next/link";
import { app } from "../lib/walkthrough";

export default function HomePage() {
  const honesty = app.honesty ?? { real: [], simulated: [] };
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12 pb-28">
      <section>
        <p className="mb-3 font-semibold text-muted-foreground text-sm uppercase tracking-[0.2em]">
          Small-Dollar Lending — scenes 1, 3 and 5
        </p>
        <h1 className="font-semibold text-4xl text-foreground tracking-tight sm:text-5xl">
          {app.appName}
        </h1>
        <p className="mt-5 max-w-3xl text-lg text-muted-foreground">
          Modelled on {app.modelledOn}, this seat plays two roles in the walkthrough: the{" "}
          <strong>traditional credit-score issuer</strong> — the "old rail" a bureau-only lender
          reads — and the <strong>furnishing recipient</strong> that receives a lender's on-time
          repayment history and builds it into the borrower's file.
        </p>
      </section>

      <section aria-labelledby="bureau-functions">
        <h2 className="font-semibold text-foreground text-xl" id="bureau-functions">
          Two functions
        </h2>
        <ul className="mt-4 grid list-none gap-4 p-0 md:grid-cols-2">
          <li>
            <Link
              className="block h-full rounded-lg border border-border bg-card p-5 no-underline transition-shadow hover:shadow-md"
              href="/credit-score"
            >
              <p
                className="text-xs uppercase tracking-[0.15em]"
                style={{ color: "var(--primary)" }}
              >
                scene 1 / scene 3 — issuer
              </p>
              <p className="mt-2 font-semibold text-card-foreground">Credit Score VC</p>
              <p className="mt-3 text-muted-foreground text-sm">
                Signs the traditional bureau score credential — thin-file facts (score, tradeline
                count, credit-history length) a bureau-only lender declines on — into the
                authenticated borrower's Data Vault pod.
              </p>
            </Link>
          </li>
          <li>
            <Link
              className="block h-full rounded-lg border border-border bg-card p-5 no-underline transition-shadow hover:shadow-md"
              href="/furnished"
            >
              <p
                className="text-xs uppercase tracking-[0.15em]"
                style={{ color: "var(--primary)" }}
              >
                scene 5 — furnishing
              </p>
              <p className="mt-2 font-semibold text-card-foreground">Furnished tradelines</p>
              <p className="mt-3 text-muted-foreground text-sm">
                Receives a Repayment-History VC furnished by a lender, verifies it end to end
                (signature, shape, validity, status, trusted issuer, subject binding), and shows
                what has been furnished to the borrower's file.
              </p>
            </Link>
          </li>
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
