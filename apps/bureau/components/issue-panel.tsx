"use client";

/**
 * The live issue panel for the bureau's ONE credential. Calls the app's
 * ISSUER rail (`/api/issue`), which requires a REAL DPoP-bound Solid-OIDC
 * session and a borrower grant naming this app's service identity. Without
 * one the rail answers 401 and this panel says so honestly — it never fakes
 * a success.
 */
import { CredentialCard } from "@jeswr/solid-showcase-kit";
import { useCallback, useState } from "react";
import { BASE_PATH } from "../lib/paths";

interface IssuedSummary {
  id: string;
  kind: string;
  validFrom: string;
  validUntil: string;
  statusListCredential: string;
  statusListIndex?: string;
}

interface IssueResult {
  simulated?: boolean;
  credential?: IssuedSummary;
  error?: string;
  detail?: string;
}

type PanelState =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "done"; result: IssueResult }
  | { phase: "failed"; status: number; result: IssueResult };

export function IssuePanel() {
  const [state, setState] = useState<PanelState>({ phase: "idle" });

  const issue = useCallback(async () => {
    setState({ phase: "busy" });
    try {
      const response = await fetch(`${BASE_PATH}/api/issue`, {
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const result = (await response.json().catch(() => ({}))) as IssueResult;
      setState(
        response.ok
          ? { phase: "done", result }
          : { phase: "failed", result, status: response.status },
      );
    } catch {
      setState({ phase: "failed", result: {}, status: 0 });
    }
  }, []);

  return (
    <section
      aria-labelledby="credit-score-panel"
      className="rounded-lg border border-border bg-card p-6"
    >
      <h2 className="font-semibold text-xl" id="credit-score-panel">
        Issue into the Data Vault
      </h2>
      <p className="mt-2 text-muted-foreground text-sm">
        Signs the Credit Score VC into your authenticated Data Vault pod. Requires a real DPoP-bound
        Solid-OIDC session and a vault grant naming this bureau's service identity.
      </p>
      <div className="mt-4">
        <button
          className="rounded-md px-4 py-2 font-medium text-sm disabled:opacity-60"
          disabled={state.phase === "busy"}
          onClick={() => void issue()}
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          type="button"
        >
          {state.phase === "busy" ? "Issuing…" : "Issue credential"}
        </button>
      </div>
      <div aria-live="polite" className="mt-4 text-sm">
        {state.phase === "done" && state.result.credential !== undefined && (
          <div data-panel-outcome="ok">
            <CredentialCard
              issuer="the bureau seat"
              status="valid"
              title={state.result.credential.kind}
              validFrom={state.result.credential.validFrom}
              validUntil={state.result.credential.validUntil}
            >
              <p>
                Credential: <code>{state.result.credential.id}</code>
              </p>
            </CredentialCard>
          </div>
        )}
        {state.phase === "failed" && (
          <p className="text-muted-foreground" data-panel-outcome="failed">
            {state.status === 401
              ? "Not signed in: this rail requires a real DPoP-bound Solid-OIDC session and a vault grant naming this bureau's service identity. Nothing was issued — this demo never fakes a success."
              : state.status === 409
                ? "Already issued: the Credit Score VC is already in your vault."
                : `The rail refused the request (${state.status || "network error"}${
                    state.result.error !== undefined ? `: ${state.result.error}` : ""
                  }). ${state.result.detail ?? ""}`}
          </p>
        )}
      </div>
    </section>
  );
}
