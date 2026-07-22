"use client";

import { HonestyPanel, ReceiptCard } from "@jeswr/solid-showcase-kit";
import { useState } from "react";
import { BASE_PATH } from "../../lib/paths";

interface Receipt {
  iri: string;
  action: "grant" | "revoke";
  actor: string;
  recipient: string;
  resource: string;
  issuedAt: string;
  provenance: "wallet" | "external";
}

interface LedgerResult {
  receipts?: Receipt[];
  error?: string;
  detail?: string;
}

/**
 * Scene 5's consent-receipt + ODRL grant ledger: every grant/revoke
 * transition, time-ordered, through the real `/api/ledger` rail. See
 * `../grants/page.tsx`'s header for the same real-session caveat.
 */
export default function LedgerPage() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<LedgerResult | undefined>(undefined);

  async function load() {
    setPending(true);
    try {
      const response = await fetch(`${BASE_PATH}/api/ledger`);
      const body = (await response.json()) as LedgerResult;
      if (!response.ok) {
        setResult({ error: `HTTP ${response.status}`, detail: JSON.stringify(body) });
      } else {
        setResult(body);
      }
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="font-semibold text-2xl">Consent-receipt ledger</h1>
        <p className="mt-2 text-muted-foreground">
          Every grant and revocation, receipted (DPV consent status + the ODRL-targeted resource),
          in the order they happened. Records from the wallet's own protected store are
          authoritative; records other apps write are shown but marked as third-party, not verified
          by the wallet.
        </p>
      </header>
      <button
        type="button"
        onClick={() => void load()}
        disabled={pending}
        className="w-fit rounded-md border px-4 py-2 font-medium text-sm disabled:opacity-50"
      >
        {pending ? "Loading…" : "Load ledger"}
      </button>
      {result?.error !== undefined && (
        <p className="text-destructive text-sm">
          {result.error}
          {result.detail !== undefined ? ` — ${result.detail}` : ""} — this rail needs a real
          signed-in Solid session.
        </p>
      )}
      {result?.receipts !== undefined && (
        <div className="flex flex-col gap-3">
          {result.receipts.length === 0 && (
            <p className="text-muted-foreground text-sm">No receipts yet.</p>
          )}
          {result.receipts.map((receipt) => (
            <div key={receipt.iri}>
              <ReceiptCard
                action={receipt.action}
                actor={receipt.actor}
                recipient={receipt.recipient}
                resource={receipt.resource}
                issuedAt={receipt.issuedAt}
              />
              {receipt.provenance === "external" && (
                <p className="mt-1 text-muted-foreground text-xs">
                  Third-party record — not verified by the wallet.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      <HonestyPanel
        real={
          <ul className="list-disc pl-5">
            <li>
              Receipts come from a real, integrity-locked pod container the wallet's own service
              identity + the borrower can write to — no granted party can forge a receipt there.
            </li>
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            <li>Every recipient and resource named here is scripted demo content.</li>
          </ul>
        }
      />
    </main>
  );
}
