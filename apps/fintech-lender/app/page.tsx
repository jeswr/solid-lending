import { HonestyPanel } from "@jeswr/solid-showcase-kit";
import Link from "next/link";
import { app } from "../lib/walkthrough";

const SCENES = [
  {
    body: "Verify Maya's zero-knowledge pre-qualification proof — income, cash-flow score, and NSF₉₀ — bound to this lender's own nonce and the issuer-signed anchors. No PII, no credit pull.",
    href: "/prequal",
    title: "Scene 2 — Shop without stripping",
  },
  {
    body: "Read the granted loan file, run two independent decisions over the SAME evidence, and deliver the Reg Z disclosure into the pod on approval.",
    href: "/application",
    title: "Scene 3 — One decision, two models",
  },
  {
    body: "Inspect the repayment authorization (1041 payment-provision rails rendered as data) and furnish the repayment-history credential toward the bureau.",
    href: "/servicing",
    title: "Scene 5 — Repay, build, stay in control",
  },
];

export default function HomePage() {
  const honesty = app.honesty ?? { real: [], simulated: [] };
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="font-semibold text-2xl">{app.appName}</h1>
        <p className="mt-2 text-muted-foreground">
          Modelled on {app.modelledOn} — the cash-flow-underwriting lender that carries this
          demo&apos;s thesis: the same borrower, the same data, decisioned two ways. Bureau-only
          prices her out; bureau plus cash flow approves her in seconds.
        </p>
      </header>

      <ul className="flex flex-col gap-4">
        {SCENES.map((scene) => (
          <li key={scene.href} className="rounded-lg border border-border p-4">
            <Link
              className="font-medium text-lg underline-offset-2 hover:underline"
              href={scene.href}
            >
              {scene.title}
            </Link>
            <p className="mt-1 text-muted-foreground text-sm">{scene.body}</p>
          </li>
        ))}
      </ul>

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
