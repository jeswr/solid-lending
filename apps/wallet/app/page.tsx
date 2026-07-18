import { HonestyPanel } from "@jeswr/solid-showcase-kit";
import Link from "next/link";
import { app } from "../lib/walkthrough";

const SURFACES = [
  {
    href: "/dev/seed",
    title: "Seed the demo persona",
    description: "Write Maya Torres's signed lending credentials into her vault (scene 1).",
  },
  {
    href: "/credentials",
    title: "Credentials",
    description: "The five verifiable credentials in her vault, verified on view.",
  },
  {
    href: "/prequal",
    title: "Prove pre-qualification",
    description: "A real ZK proof of income/score/NSF eligibility, no figures disclosed (scene 2).",
  },
  {
    href: "/grants",
    title: "Access grants",
    description: "Grant or revoke a party's access to one credential or document (scenes 3-5).",
  },
  {
    href: "/ledger",
    title: "Consent-receipt ledger",
    description: "Every grant and revocation, receipted and time-ordered (scene 5).",
  },
] as const;

/**
 * The vault's home: role-first framing (design §6.1) plus links to every
 * scene surface. Its name, theme, and honesty content come from the
 * registry entry in apps/tour/content/walkthrough.json.
 */
export default function HomePage() {
  const honesty = app.honesty ?? { real: [], simulated: [] };
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="font-semibold text-2xl">{app.appName}</h1>
        <p className="mt-2 text-muted-foreground">
          Maya's borrower-controlled data vault, modelled on {app.modelledOn}. Her identity, income,
          cash-flow, and loan records live here, only she controls — every party gets scoped,
          receipted, revocable access, and she can prove eligibility without disclosing the
          underlying figures.
        </p>
      </header>
      <nav className="grid gap-4 sm:grid-cols-2">
        {SURFACES.map((surface) => (
          <Link
            key={surface.href}
            href={surface.href}
            className="rounded-md border p-4 transition hover:bg-muted"
          >
            <h2 className="font-medium">{surface.title}</h2>
            <p className="mt-1 text-muted-foreground text-sm">{surface.description}</p>
          </Link>
        ))}
      </nav>
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
