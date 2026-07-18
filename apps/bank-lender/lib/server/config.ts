import {
  configFromEnv as podGuardConfigFromEnv,
  type PodGuardConfig,
} from "@jeswr/solid-pod-guard";

/**
 * Server-side configuration for the Personal Loan Desk rails (scenes 2-3):
 * scene-2 ZK pre-qualification verify, scene-3 BUREAU-ONLY decisioning over
 * the GRANTED credit-score credential only. EVERYTHING here fails closed: an
 * unset allowlist or an unconfigured service identity disables the rail
 * (503) rather than opening it.
 *
 * The pod-guard base (`LENDING_TRUSTED_OIDC_ISSUERS`,
 * `LENDING_POD_ALLOWED_ORIGINS`, `LENDING_DEV_ALLOW_LOOPBACK`,
 * `LENDING_TRUST_FORWARDED_HEADERS`) is read verbatim from
 * `@jeswr/solid-pod-guard`'s `configFromEnv("LENDING")` — every app in this
 * workspace shares that prefix. This app adds its OWN service identity (L4)
 * and the issuer allowlists `verifyPreQualification`/`verifyCredential`
 * require.
 */
export const ENV_PREFIX = "LENDING";

export interface BankLenderConfig extends PodGuardConfig {
  /**
   * Issuers trusted to sign the ZK operand-anchor VCs scene-2 pre-qual
   * verifies against (decision 0012). The self-hosted demo issuer
   * (`lib/server/demo-issuer.ts`) is ALWAYS added by the service layer so the
   * standalone walkthrough works without a live `verifications` deployment —
   * see that module's header for the honesty framing.
   */
  readonly trustedAnchorIssuers: readonly string[];
  /**
   * Issuers trusted to sign the borrower's credit-score credential this
   * lender reads under a grant (scene 3, BUREAU-ONLY — no cash-flow issuer
   * is ever consulted). REQUIRED for the credential to pass full
   * `verifyCredential`; an empty list fails the whole origination closed
   * (503) — no green tick, no "verified" claim, no decision on unverifiable
   * data.
   */
  readonly trustedCredentialIssuers: readonly string[];
  /** This lender's OWN identity — the `issuer`/`agent` of everything it writes into the pod. */
  readonly bankLenderWebId: string;
  /**
   * The service identity (decision 0015 L4) the borrower's grant names for
   * read access to the granted credit-score credential and write access to
   * the adverse-action notice / offer documents. `undefined` fails the rail
   * closed (503) — there is NO anonymous fallback.
   */
  readonly serviceWebId: string | undefined;
  /** OIDC issuer of the service identity (client_credentials + DPoP). */
  readonly podServiceIssuer: string | undefined;
  /** Confidential client id for the service identity. */
  readonly podServiceClientId: string | undefined;
  /** Confidential client secret for the service identity (server env only — never bundled). */
  readonly podServiceClientSecret: string | undefined;
}

function splitList(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** The demo bank's own identity IRI (RFC 2606 `.example`; role-first, matches the fintech sibling's convention — decision 0010). */
export const DEFAULT_BANK_LENDER_WEBID = "https://bank-lender.example/orgs/personal-loan-desk#id";

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): BankLenderConfig {
  const base = podGuardConfigFromEnv(ENV_PREFIX, env);
  return {
    ...base,
    bankLenderWebId: env.LENDING_BANK_LENDER_WEBID?.trim() || DEFAULT_BANK_LENDER_WEBID,
    podServiceClientId: env.LENDING_BANK_POD_SERVICE_CLIENT_ID,
    podServiceClientSecret: env.LENDING_BANK_POD_SERVICE_CLIENT_SECRET,
    podServiceIssuer: env.LENDING_BANK_POD_SERVICE_ISSUER,
    serviceWebId: env.LENDING_BANK_SERVICE_WEBID,
    trustedAnchorIssuers: splitList(env.LENDING_TRUSTED_ANCHOR_ISSUERS),
    trustedCredentialIssuers: splitList(env.LENDING_TRUSTED_CREDENTIAL_ISSUERS),
  };
}

/** Standard "rail not configured" fail-closed response. */
export function notConfigured(detail: string): Response {
  return Response.json(
    {
      simulated: true,
      error: "not_configured",
      detail: `${detail} — this rail fails closed until an operator configures it`,
    },
    { status: 503 },
  );
}

/** A required, non-empty config string — absent values fail closed as 503 upstream. */
export function requiredConfig(value: string | undefined, label: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${label} is unset`);
  }
  return value;
}
