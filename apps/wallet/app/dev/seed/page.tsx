"use client";

import { useState } from "react";
import { BASE_PATH } from "../../../lib/paths";

interface SeedResult {
  persona: string;
  webid: string;
  baseUrl: string;
  resources: { url: string; status: string }[];
}

interface SeedError {
  error: string;
}

/**
 * Dev-only "Mode-1" seed trigger (sm-qz3j): a browser button that POSTs
 * `/api/dev/seed`, which seeds Maya Torres's REAL signed lending-credential pod
 * (`@lending/seeds`) — see `../../../lib/server/dev-seed.ts` for why this, rather than an
 * in-browser WASM pod, is this scaffold's Mode-1. Concept demonstration only; the fixed
 * disclaimer banner from the root layout still applies here.
 */
export default function DevSeedPage() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SeedResult | SeedError | undefined>(undefined);

  async function seed() {
    setPending(true);
    setResult(undefined);
    try {
      const response = await fetch(`${BASE_PATH}/api/dev/seed`, { method: "POST" });
      const body = (await response.json()) as SeedResult | SeedError;
      setResult(body);
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="font-semibold text-2xl">Seed the demo persona</h1>
        <p className="mt-2 text-muted-foreground">
          Development only. Seeds Maya Torres's real signed lending credentials and ZK operand
          anchors into the pod named by <code>LENDING_SEED_POD_URL</code> /{" "}
          <code>LENDING_SEED_WEBID</code> — the same target <code>pnpm run seed</code> writes to.
          Safe to click repeatedly (converges, never clobbers).
        </p>
      </header>
      <button
        type="button"
        onClick={() => void seed()}
        disabled={pending}
        className="w-fit rounded-md border px-4 py-2 font-medium text-sm disabled:opacity-50"
      >
        {pending ? "Seeding…" : "Seed demo persona"}
      </button>
      {result !== undefined && (
        <pre className="overflow-x-auto rounded-md border bg-muted p-4 text-xs">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}
