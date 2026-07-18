"use client";

import { CredentialCard, type CredentialStatus, HonestyPanel } from "@jeswr/solid-showcase-kit";
import { useState } from "react";

interface CredentialSummary {
  id: string;
  title: string;
  issuer: string;
  validFrom?: string;
  validUntil?: string;
  status: CredentialStatus;
  errors: string[];
}

interface CredentialsResult {
  credentials?: CredentialSummary[];
  error?: string;
  detail?: string;
}

/**
 * Scene 1 "fill the vault": the five signed lending VCs in Maya's Data Vault,
 * each verify-on-view (signature, issuer key binding, validity window,
 * revocation status, SHACL shape — see `../../lib/server/credential-summary.ts`).
 * Browser-triggered, server-verified (Node-only `@lending/vc-kit` — see that
 * module's header).
 */
export default function CredentialsPage() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CredentialsResult | undefined>(undefined);

  async function load() {
    setPending(true);
    try {
      const response = await fetch("/api/dev/credentials");
      const body = (await response.json()) as CredentialsResult;
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
        <h1 className="font-semibold text-2xl">Credentials</h1>
        <p className="mt-2 text-muted-foreground">
          The verifiable credentials Maya's issuers have written into her vault. Each card runs the
          full verify-on-view chain: signature, issuer key binding, validity window, revocation
          status, and shape — every time you load this page.
        </p>
      </header>
      <button
        type="button"
        onClick={() => void load()}
        disabled={pending}
        className="w-fit rounded-md border px-4 py-2 font-medium text-sm disabled:opacity-50"
      >
        {pending ? "Verifying…" : "Load + verify credentials"}
      </button>
      {result?.error !== undefined && (
        <p className="text-destructive text-sm">
          {result.error}
          {result.detail !== undefined ? `: ${result.detail}` : ""}
        </p>
      )}
      {result?.credentials !== undefined && (
        <div className="grid gap-4 sm:grid-cols-2">
          {result.credentials.map((credential) => (
            <CredentialCard
              key={credential.id}
              title={credential.title}
              issuer={credential.issuer}
              validFrom={credential.validFrom}
              validUntil={credential.validUntil}
              status={credential.status}
            >
              {credential.errors.length > 0 && (
                <ul className="mt-2 list-disc pl-4 text-destructive text-xs">
                  {credential.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
            </CredentialCard>
          ))}
        </div>
      )}
      <HonestyPanel
        real={
          <ul className="list-disc pl-5">
            <li>
              Every card runs the real fail-closed vc-kit verify chain against the pod-served
              documents — signature, issuer key binding, validity window, revocation status, SHACL
              shape.
            </li>
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            <li>
              All five credentials are scripted demo content for a fictional borrower, issued by
              this repo's dev seeder — no real verification service was called.
            </li>
          </ul>
        }
      />
    </main>
  );
}
