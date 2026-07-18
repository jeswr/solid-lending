import { HonestyPanel } from "@jeswr/solid-showcase-kit";
import Link from "next/link";
import { app } from "../lib/walkthrough";

const SCENES = [
  {
    body: "Verify Maya's zero-knowledge pre-qualification proof — income, cash-flow score, and NSF₉₀ — bound to this bank's own nonce and the issuer-signed anchors. No PII, no credit pull.",
    href: "/prequal",
    title: "Scene 2 — Shop without stripping",
  },
  {
    body: "Read the granted credit-score credential ONLY — this desk never sees cash-flow evidence — and render the bureau-only decision honestly, including the Reg B adverse-action notice on decline.",
    href: "/application",
    title: "Scene 3 — One decision, two models (the bank's seat)",
  },
];

export default function HomePage() {
  const honesty = app.honesty ?? { real: [], simulated: [] };
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <header>
        <h1 className="font-semibold text-2xl">{app.appName}</h1>
        <p className="mt-2 text-muted-foreground">
          Modelled on {app.modelledOn} — the traditional-rail installment lender that plays this
          demo&apos;s honest contrast: the same borrower, the same evidence, but this desk decides
          on the bureau file alone. Where cash-flow underwriting sees a bank-affirming pattern,
          bureau-only decisioning sees a thin file — and says so, on the record, with the reasons.
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
