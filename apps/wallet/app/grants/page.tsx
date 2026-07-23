"use client";

import { HonestyPanel } from "@jeswr/solid-showcase-kit";
import { useState } from "react";
import { GRANT_PARTIES, GRANT_PARTY_IDS, type GrantPartyId } from "../../lib/grants/parties";
import { BASE_PATH } from "../../lib/paths";
import { RESOURCE_CATALOG, type ResourceId } from "../../lib/grants/resources";

interface Standing {
  agent: string;
  resource: ResourceId;
  granted: boolean;
  modes: string[];
  revoked: boolean;
}

interface Party {
  id: GrantPartyId;
  label: string;
  webid: string;
  resources: ResourceId[];
}

interface GrantsResult {
  parties?: Party[];
  standings?: Standing[];
  error?: string;
  detail?: string;
}

/**
 * Scenes 3-5's access-grant dashboard (design §6.1/§6.2): grant/revoke ONE
 * party's access to ONE catalogue resource at a time via the real Mode-2
 * `/api/grants*` rail (`@jeswr/solid-pod-guard`). This surface requires a
 * REAL DPoP-bound Solid-OIDC session — this scaffold has no borrower login
 * UI yet (see the README "known demo-scope limitations", the same gap the
 * mortgage showcase's own wallet documents), so a deployed visitor without a
 * session sees the rail's own honest 401, not a fake bypass. The rail itself
 * is exercised end-to-end by `test/grant-rail.test.ts` with real sessions.
 */
export default function GrantsPage() {
  const [pending, setPending] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<GrantsResult | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);

  async function refresh() {
    setPending("refresh");
    try {
      const response = await fetch(`${BASE_PATH}/api/grants`);
      const body = (await response.json()) as GrantsResult;
      if (!response.ok) {
        setResult({ error: `HTTP ${response.status}`, detail: JSON.stringify(body) });
      } else {
        setResult(body);
      }
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(undefined);
    }
  }

  async function change(party: GrantPartyId, resource: ResourceId, action: "grant" | "revoke") {
    setPending(`${party}:${resource}:${action}`);
    setMessage(undefined);
    try {
      const response = await fetch(`${BASE_PATH}/api/grants/change`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ party, resource, action }),
      });
      const body = (await response.json()) as { detail?: string };
      setMessage(
        response.ok
          ? `${action === "grant" ? "Granted" : "Revoked"} ${resource} for ${party}.`
          : `HTTP ${response.status}${body.detail !== undefined ? `: ${body.detail}` : ""}`,
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(undefined);
    }
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
      <header>
        <h1 className="font-semibold text-2xl">Access grants</h1>
        <p className="mt-2 text-muted-foreground">
          Grant or revoke one party's access to one credential or document. Every change rebuilds
          that resource's real WAC access rule and writes a consent receipt.
        </p>
      </header>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={pending !== undefined}
        className="w-fit rounded-md border px-4 py-2 font-medium text-sm disabled:opacity-50"
      >
        {pending === "refresh" ? "Loading…" : "Load my grants"}
      </button>
      {message !== undefined && <p className="text-sm">{message}</p>}
      {result?.error !== undefined && (
        <p className="text-destructive text-sm">
          {result.error}
          {result.detail !== undefined ? ` — ${result.detail}` : ""} — this rail needs a real
          signed-in Solid session, which this demo scaffold does not yet provide a login UI for.
        </p>
      )}
      {GRANT_PARTY_IDS.map((partyId) => {
        const definition = GRANT_PARTIES[partyId];
        return (
          <section key={partyId} className="rounded-md border p-4">
            <h2 className="font-medium">{definition.label}</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {definition.resources.map(({ resource, write }) => {
                const standing = result?.standings?.find(
                  (entry) =>
                    entry.resource === resource &&
                    entry.agent === result.parties?.find((party) => party.id === partyId)?.webid,
                );
                return (
                  <li key={resource} className="flex items-center justify-between gap-4 text-sm">
                    <span>
                      {RESOURCE_CATALOG[resource].label}
                      {write ? " (read + write)" : " (read)"}
                      {standing !== undefined && (
                        <span className="ml-2 text-muted-foreground">
                          {standing.granted
                            ? "granted"
                            : standing.revoked
                              ? "revoked"
                              : "not granted"}
                        </span>
                      )}
                    </span>
                    <span className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void change(partyId, resource, "grant")}
                        disabled={pending !== undefined}
                        className="rounded-md border px-3 py-1 text-xs disabled:opacity-50"
                      >
                        Grant
                      </button>
                      <button
                        type="button"
                        onClick={() => void change(partyId, resource, "revoke")}
                        disabled={pending !== undefined}
                        className="rounded-md border px-3 py-1 text-xs disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      <HonestyPanel
        real={
          <ul className="list-disc pl-5">
            <li>
              Grant/revoke runs through the real `@jeswr/solid-pod-guard` boundary — DPoP-bound
              auth, pim:storage pod binding, and a real WAC rewrite on the pod. Revocation is
              immutable; repeats are refused.
            </li>
          </ul>
        }
        simulated={
          <ul className="list-disc pl-5">
            <li>
              This scaffold has no borrower login UI yet, so a visitor here without a real Solid
              session sees the rail's own honest 401 — the same gap the mortgage showcase's wallet
              documents.
            </li>
          </ul>
        }
      />
    </main>
  );
}
