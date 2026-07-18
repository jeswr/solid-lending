import {
  configFromEnv as podGuardConfigFromEnv,
  type PodGuardConfig,
} from "@jeswr/solid-pod-guard";

/**
 * Server-side configuration for the Instant Payout rail (sm-qz3j.5; design
 * §6.1/§6.2, scene 4 "funded in minutes"): read + verify the borrower's
 * GRANTED loan offer (the scene-4 funding instruction), run the simulated
 * push-to-card payout, and sign + deliver the Disbursement Receipt VC.
 * EVERYTHING here fails closed: an unset allowlist, issuer trust list, or
 * service/signing identity disables the rail (503) rather than opening it.
 *
 * The pod-guard base (`LENDING_TRUSTED_OIDC_ISSUERS`, `LENDING_POD_ALLOWED_ORIGINS`,
 * `LENDING_DEV_ALLOW_LOOPBACK`, `LENDING_TRUST_FORWARDED_HEADERS`) is read
 * verbatim from `@jeswr/solid-pod-guard`'s `configFromEnv("LENDING")` — every
 * app in this workspace shares that prefix. This app adds its OWN L4 service
 * identity (pod IO) and its OWN L-issuer identity (signing the receipt).
 */
export const ENV_PREFIX = "LENDING";

export interface DisbursementConfig extends PodGuardConfig {
  /**
   * Issuers trusted to have signed the loan-offer document scene 4 reads as
   * its funding instruction (design §6.2 row 6/7: "That same document IS the
   * scene-4 funding instruction the disbursement app reads — principal
   * amount + subject WebID"). REQUIRED for a payout: an empty list fails the
   * whole rail closed (503) — no payout, no receipt, ever, on unverifiable
   * data.
   */
  readonly trustedOfferIssuers: readonly string[];
  /** This rail's OWN identity — the `issuer` of the Disbursement Receipt VC it signs. */
  readonly disbursementWebId: string;
  /** This rail's private signing JWK (Ed25519, `eddsa-rdfc-2022`) as JSON. Unset ⇒ 503. */
  readonly issuerKeyJwk: string | undefined;
  /** The signing key's verification-method IRI. Default: `<disbursementWebId document>#vc-key`. */
  readonly issuerKeyVerificationMethod: string | undefined;
  /** This rail's hosted Bitstring revocation list URL for the receipts it signs. Unset ⇒ 503. */
  readonly statusListUrl: string | undefined;
  /**
   * The service identity (decision 0015 L4) the borrower's grant names for
   * read access to the loan-offer document and write access to the
   * disbursement-receipt document. `undefined` fails the rail closed (503) —
   * there is NO anonymous fallback.
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

/** This rail's own identity IRI (RFC 2606 `.example`; matches the persona fixtures' issuers.disbursementNetwork — decision 0010). */
export const DEFAULT_DISBURSEMENT_WEBID = "https://disbursement.example/orgs/instant-payout#id";

function trimmed(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned === undefined || cleaned === "" ? undefined : cleaned;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): DisbursementConfig {
  const base = podGuardConfigFromEnv(ENV_PREFIX, env);
  return {
    ...base,
    disbursementWebId: env.LENDING_DISBURSEMENT_WEBID?.trim() || DEFAULT_DISBURSEMENT_WEBID,
    issuerKeyJwk: trimmed(env.LENDING_DISBURSEMENT_ISSUER_KEY_JWK),
    issuerKeyVerificationMethod: trimmed(env.LENDING_DISBURSEMENT_ISSUER_KEY_VM),
    podServiceClientId: trimmed(env.LENDING_DISBURSEMENT_POD_SERVICE_CLIENT_ID),
    podServiceClientSecret: trimmed(env.LENDING_DISBURSEMENT_POD_SERVICE_CLIENT_SECRET),
    podServiceIssuer: trimmed(env.LENDING_DISBURSEMENT_POD_SERVICE_ISSUER),
    serviceWebId: trimmed(env.LENDING_DISBURSEMENT_SERVICE_WEBID),
    statusListUrl: trimmed(env.LENDING_DISBURSEMENT_STATUS_LIST_URL),
    trustedOfferIssuers: splitList(env.LENDING_DISBURSEMENT_TRUSTED_OFFER_ISSUERS),
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
