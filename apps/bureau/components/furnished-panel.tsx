"use client";

/**
 * The live furnished-tradelines view. Calls the app's furnishing rail's GET
 * `/api/furnished`, which requires a REAL DPoP-bound Solid-OIDC session
 * (@jeswr/solid-pod-guard) and returns ONLY the caller's own furnished
 * records. Without a session the rail answers 401 and this panel says so
 * honestly — it never fakes furnished data.
 */
import { useCallback, useEffect, useState } from "react";
import { BASE_PATH } from "../lib/paths";

interface Tradeline {
  credentialId: string;
  furnishedAt: string;
  issuer: string;
  latePaymentCount: number;
  onTimePaymentCount: number;
  scheduledPaymentCount: number;
  servicedLoan: string;
}

interface FurnishedResult {
  simulated?: boolean;
  tradelines?: Tradeline[];
  error?: string;
  detail?: string;
}

type PanelState =
  | { phase: "loading" }
  | { phase: "loaded"; tradelines: Tradeline[] }
  | { phase: "failed"; status: number; result: FurnishedResult };

export function FurnishedPanel() {
  const [state, setState] = useState<PanelState>({ phase: "loading" });

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const response = await fetch(`${BASE_PATH}/api/furnished`);
      const result = (await response.json().catch(() => ({}))) as FurnishedResult;
      setState(
        response.ok
          ? { phase: "loaded", tradelines: result.tradelines ?? [] }
          : { phase: "failed", result, status: response.status },
      );
    } catch {
      setState({ phase: "failed", result: {}, status: 0 });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section
      aria-labelledby="furnished-panel"
      className="rounded-lg border border-border bg-card p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-semibold text-xl" id="furnished-panel">
          Furnished tradelines
        </h2>
        <button
          className="rounded-md border border-border px-3 py-1.5 font-medium text-sm disabled:opacity-60"
          disabled={state.phase === "loading"}
          onClick={() => void load()}
          type="button"
        >
          Refresh
        </button>
      </div>
      <div aria-live="polite" className="mt-4 text-sm">
        {state.phase === "loading" && <p className="text-muted-foreground">Loading…</p>}
        {state.phase === "failed" && (
          <p className="text-muted-foreground" data-panel-outcome="failed">
            {state.status === 401
              ? "Not signed in: this view requires a real DPoP-bound Solid-OIDC session. This demo never fakes furnished data."
              : `The rail refused the request (${state.status || "network error"}${
                  state.result.error !== undefined ? `: ${state.result.error}` : ""
                }). ${state.result.detail ?? ""}`}
          </p>
        )}
        {state.phase === "loaded" && state.tradelines.length === 0 && (
          <p className="text-muted-foreground" data-panel-outcome="empty">
            Nothing furnished yet — a lender furnishes a Repayment-History VC by presenting it to{" "}
            <code>POST /api/furnish</code>. This bureau seat verifies it end to end before it ever
            appears here.
          </p>
        )}
        {state.phase === "loaded" && state.tradelines.length > 0 && (
          <ul className="grid list-none gap-3 p-0" data-panel-outcome="ok">
            {state.tradelines.map((tradeline) => (
              <li
                className="rounded-lg border border-border bg-background p-4"
                key={tradeline.credentialId}
              >
                <p className="font-medium">
                  {tradeline.onTimePaymentCount}/{tradeline.scheduledPaymentCount} on-time,{" "}
                  {tradeline.latePaymentCount} late
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  Furnished by <code>{tradeline.issuer}</code> at {tradeline.furnishedAt}
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  Serviced loan: <code>{tradeline.servicedLoan}</code>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
