/**
 * Verify-on-view for the vault's credential list (scene 1): the FULL
 * fail-closed `verifyCredential` gate chain (signature, issuer key binding,
 * validity window, revocation status, SHACL shape) against the dev-seeded
 * pod's five real signed lending VCs. NODE-ONLY — see
 * `./prequal-witness.ts`'s header for why (`@lending/vc-kit`'s bundle
 * statically imports `node:crypto`/`node:zlib`); this runs server-side,
 * browser-triggered, exactly like `./dev-seed.ts`.
 */
import { type LendingResourceKind, RESOURCE_POD_PATHS } from "@lending/data-model";
import { ISSUER_ROLES, type LendingSeedIssuerRole } from "@lending/seeds";
import { verifyCredential } from "@lending/vc-kit";

export type CredentialStatusLabel = "valid" | "pending" | "expired" | "revoked";

export interface CredentialSummary {
  readonly id: string;
  readonly title: string;
  readonly issuer: string;
  readonly validFrom?: string;
  readonly validUntil?: string;
  readonly status: CredentialStatusLabel;
  readonly errors: readonly string[];
}

const SUMMARY_CREDENTIALS: readonly {
  id: string;
  title: string;
  kind: LendingResourceKind;
  path: string;
  issuerRole: LendingSeedIssuerRole;
  issuerLabel: string;
}[] = [
  {
    id: "identity",
    title: "Identity",
    kind: "identity-credential",
    path: RESOURCE_POD_PATHS["identity-credential"],
    issuerRole: "identityVerifier",
    issuerLabel: ISSUER_ROLES.identityVerifier.label,
  },
  {
    id: "income",
    title: "Employment + income",
    kind: "employment-income-credential",
    path: RESOURCE_POD_PATHS["employment-income-credential"],
    issuerRole: "incomeVerifier",
    issuerLabel: ISSUER_ROLES.incomeVerifier.label,
  },
  {
    id: "bankCashFlow",
    title: "Bank cash-flow",
    kind: "bank-cashflow-credential",
    path: RESOURCE_POD_PATHS["bank-cashflow-credential"],
    issuerRole: "bankDataProvider",
    issuerLabel: ISSUER_ROLES.bankDataProvider.label,
  },
  {
    id: "cashFlowScore",
    title: "Cash-flow score",
    kind: "cashflow-score-credential",
    path: RESOURCE_POD_PATHS["cashflow-score-credential"],
    issuerRole: "cashFlowScorer",
    issuerLabel: ISSUER_ROLES.cashFlowScorer.label,
  },
  {
    id: "creditScore",
    title: "Credit score (bureau)",
    kind: "credit-score-credential",
    path: RESOURCE_POD_PATHS["credit-score-credential"],
    issuerRole: "creditBureau",
    issuerLabel: ISSUER_ROLES.creditBureau.label,
  },
];

function statusLabelFor(
  verified: boolean,
  errors: readonly { code: string }[],
): CredentialStatusLabel {
  if (verified) return "valid";
  if (
    errors.some((error) => error.code === "STATUS_REVOKED" || error.code === "STATUS_SUSPENDED")
  ) {
    return "revoked";
  }
  if (errors.some((error) => error.code === "EXPIRED")) return "expired";
  if (errors.some((error) => error.code === "NOT_YET_VALID")) return "pending";
  return "revoked";
}

/**
 * Milliseconds before a pod fetch (credential document, issuer WebID
 * document, or Bitstring status list) is abandoned and treated as
 * unreachable. Verify-on-view is a fail-closed gate chain (see the module
 * header) — an unreachable dependency must fail the credential CLOSED and
 * PROMPTLY, never hang the route indefinitely (Node's/undici's default
 * `fetch` has no idle timeout of its own).
 */
const POD_FETCH_TIMEOUT_MS = 15_000;

/** Wrap a `fetch` so every call is bounded by {@link POD_FETCH_TIMEOUT_MS} —
 * used for both the credential-document GET below and the `webIdFetch`/
 * `statusFetch` seams handed to `verifyCredential` (key resolution + status
 * list resolution), so a stalled loopback pod fails this credential closed
 * instead of hanging the whole route. */
function withPodFetchTimeout(fetchImpl: typeof fetch): typeof fetch {
  return (async (input, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POD_FETCH_TIMEOUT_MS);
    try {
      return await fetchImpl(input, { ...init, signal: init?.signal ?? controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }) as typeof fetch;
}

/** Plain (unauthenticated) reads: the issuer WebID document and status list
 * are ALWAYS public-read (`publicReadAcl`, same as the seeder's own issuer
 * seats) — no wallet identity is needed for either. */
const publicPodFetch = withPodFetchTimeout(fetch);

export async function readCredentialSummaries(options: {
  readonly podBase: string;
  readonly now: Date;
  /**
   * The wallet's OWN service-identity fetch — REQUIRED to read the
   * credential documents themselves: the pod runs real Solid-OIDC + DPoP
   * verification (never an unauthenticated-owner bypass), and each
   * credential's ACL grants `wallet-service` (this identity) Read/Write/
   * Control explicitly (see `journey.spec.ts`'s `seededCredentialAgents`
   * ACL provisioning, and this app's own `wallet-grant-service.ts`'s
   * identical `createServicePodFetch` seam). Still timeout-bounded (see
   * `POD_FETCH_TIMEOUT_MS`) — a stalled read fails this credential closed.
   */
  readonly podFetch: typeof fetch;
}): Promise<readonly CredentialSummary[]> {
  const credentialFetch = withPodFetchTimeout(options.podFetch);
  return Promise.all(
    SUMMARY_CREDENTIALS.map(async (entry) => {
      const iri = `${options.podBase}${entry.path.slice(1)}`;
      const issuer = `${options.podBase}${ISSUER_ROLES[entry.issuerRole].docPath.slice(1)}`;
      try {
        const response = await credentialFetch(iri);
        if (!response.ok) {
          return {
            id: entry.id,
            title: entry.title,
            issuer: entry.issuerLabel,
            status: "revoked" as const,
            errors: [`could not read the credential (HTTP ${response.status})`],
          };
        }
        const turtle = await response.text();
        // Explicit plain fetch: solid-vc's DEFAULT webId/status resolver is
        // SSRF-guarded and refuses loopback http outright, with no config
        // knob reaching it from here — this dev-seeded pod is plain loopback
        // http by design (see `./prequal-service.ts`'s identical note). Both
        // targets are public-read (see `publicPodFetch`'s note), so no
        // wallet identity is needed — only bounded so an unreachable
        // document fails this credential closed within
        // `POD_FETCH_TIMEOUT_MS`, never hangs the route.
        const outcome = await verifyCredential(turtle, {
          expectShape: entry.kind,
          now: options.now,
          trustedIssuers: [issuer],
          webIdFetch: publicPodFetch,
          statusFetch: publicPodFetch,
        });
        return {
          id: entry.id,
          title: entry.title,
          issuer: entry.issuerLabel,
          ...(outcome.credential?.validFrom !== undefined
            ? { validFrom: outcome.credential.validFrom }
            : {}),
          ...(outcome.credential?.validUntil !== undefined
            ? { validUntil: outcome.credential.validUntil }
            : {}),
          status: statusLabelFor(outcome.verified, outcome.errors),
          errors: outcome.errors.map((error) => `${error.code}: ${error.message}`),
        };
      } catch (error) {
        return {
          id: entry.id,
          title: entry.title,
          issuer: entry.issuerLabel,
          status: "revoked" as const,
          errors: [(error as Error).message],
        };
      }
    }),
  );
}
