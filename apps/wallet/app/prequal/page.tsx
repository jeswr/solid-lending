"use client";

import { HonestyPanel, StatCard } from "@jeswr/solid-showcase-kit";
import { useState } from "react";

interface ProveResult {
  verified?: boolean;
  errors?: readonly { code: string; message: string }[];
  proveMs?: Record<string, number>;
  error?: string;
  detail?: string;
}

/**
 * Scene 2 "shop without stripping": prove `income >= $2,200/mo ∧ cash-flow
 * score >= 660 ∧ NSF₉₀ = 0` over Maya's seeded operand anchors, without
 * disclosing the underlying values — a real sparq UltraHonk proof, checked
 * by the real fail-closed verifier (`../../lib/server/prequal-service.ts`).
 */
export default function PreQualPage() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ProveResult | undefined>(undefined);

  async function proveAndVerify() {
    setPending(true);
    setResult(undefined);
    try {
      const challengeResponse = await fetch("/api/dev/prequal/challenge", { method: "POST" });
      const challenge = (await challengeResponse.json()) as {
        sessionKey?: string;
        nonce?: string;
        error?: string;
        detail?: string;
      };
      if (
        !challengeResponse.ok ||
        challenge.sessionKey === undefined ||
        challenge.nonce === undefined
      ) {
        setResult({ error: challenge.error, detail: challenge.detail });
        return;
      }
      const proveResponse = await fetch("/api/dev/prequal/prove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionKey: challenge.sessionKey, nonce: challenge.nonce }),
      });
      const body = (await proveResponse.json()) as ProveResult;
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
        <h1 className="font-semibold text-2xl">Prove pre-qualification</h1>
        <p className="mt-2 text-muted-foreground">
          Prove income ≥ $2,200/mo, cash-flow score ≥ 660, and zero NSF events in the last 90 days —
          without disclosing the underlying figures. A genuine sparq UltraHonk proof, bound to a
          single-use challenge, checked by the real fail-closed verifier chain.
        </p>
      </header>
      <button
        type="button"
        onClick={() => void proveAndVerify()}
        disabled={pending}
        className="w-fit rounded-md border px-4 py-2 font-medium text-sm disabled:opacity-50"
      >
        {pending ? "Proving (a few seconds)…" : "Prove eligibility"}
      </button>
      {result?.error !== undefined && (
        <p className="text-destructive text-sm">
          {result.error}
          {result.detail !== undefined ? `: ${result.detail}` : ""}
        </p>
      )}
      {result?.verified !== undefined && (
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard
            label="Pre-qualification"
            value={result.verified ? "Verified" : "Not verified"}
            detail={result.verified ? "All three legs proved and verified" : undefined}
          />
          {result.proveMs !== undefined && (
            <StatCard
              label="Proving time"
              value={`${Math.round(
                Object.values(result.proveMs).reduce((total, ms) => total + ms, 0),
              )} ms`}
              detail="sum of the three legs' proving time"
              illustrative
            />
          )}
        </div>
      )}
      {result?.errors !== undefined && result.errors.length > 0 && (
        <ul className="list-disc pl-5 text-destructive text-xs">
          {result.errors.map((error) => (
            <li key={error.code}>
              {error.code}: {error.message}
            </li>
          ))}
        </ul>
      )}
      <HonestyPanel
        real={
          <ul className="list-disc pl-5">
            <li>
              The proof is genuinely computed by sparq's UltraHonk prover over your seeded operand
              anchors, and checked by the real nine-gate fail-closed verifier — nothing here is
              mocked.
            </li>
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            <li>
              This scaffold has no in-browser WASM runtime yet, so proving runs server-side in this
              dev environment rather than literally inside your browser tab; there is no live lender
              rail in this repo yet to send the proof to, so this route also stands in as the
              verifier.
            </li>
          </ul>
        }
      />
    </main>
  );
}
