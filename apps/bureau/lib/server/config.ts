/**
 * Server-side configuration for the bureau's two rails (sm-qz3j.5; design
 * §6.1/§6.2, scenes 1, 3 and 5): the ISSUER boundary (the traditional bureau
 * Credit Score VC — the "old rail" the bank-lender's bureau-only decision
 * reads in scene 3) and the FURNISHING intake (the scene-5 Repayment-History
 * VC the fintech lender furnishes toward the bureau — the credit-graduation
 * close).
 *
 * The pod-route boundary itself (DPoP-bound auth, the bidirectional
 * pim:storage pod binding, pod/webid override rejection) is
 * @jeswr/solid-pod-guard's `configFromEnv`/`createPodRouteGuard` — see
 * `guardConfig()` below. The bureau's OWN issuer identity (signing key,
 * WebID, hosted status list), its OWN service identity (L4 pod IO for the
 * issue rail), and the furnishing intake's trusted-furnisher allowlist are
 * this app's own extension, read here. Everything fails closed: an unset
 * issuer key/WebID/status-list URL, an unconfigured service identity, or an
 * empty trusted-furnisher allowlist disables the corresponding rail (503)
 * rather than opening it — issuer signing keys are private JWKs in server
 * env and never reach a client bundle.
 */
import { configFromEnv, type PodGuardConfig } from "@jeswr/solid-pod-guard";

/**
 * The pod-guard rail's env prefix: `configFromEnv` reads
 * `LENDING_TRUSTED_OIDC_ISSUERS`, `LENDING_POD_ALLOWED_ORIGINS`,
 * `LENDING_DEV_ALLOW_LOOPBACK`, and
 * `LENDING_TRUST_FORWARDED_HEADERS` (see .env.example + docs/deploy.md).
 * Everything fails closed while unset.
 */
export const ENV_PREFIX = "LENDING";

export function guardConfig(): PodGuardConfig {
  return configFromEnv(ENV_PREFIX);
}

/** The bureau's own issuer identity (operator env; see the env table below). */
export interface BureauIssuerConfig {
  /** The bureau's WebID (must publish the verification method). */
  readonly webid: string | undefined;
  /** The issuer's private signing JWK (Ed25519, `eddsa-rdfc-2022`) as JSON. */
  readonly keyJwk: string | undefined;
  /** The key's verification-method IRI. Default: `<webid document>#vc-key`. */
  readonly keyVerificationMethod: string | undefined;
  /** The bureau's hosted Bitstring revocation list URL. */
  readonly statusListUrl: string | undefined;
}

export interface BureauConfig {
  readonly issuer: BureauIssuerConfig;
  /** The app's OWN service WebID (L4) — the agent a borrower's grant names for pod IO. */
  readonly serviceWebId: string | undefined;
  /** OIDC issuer of the service identity (client_credentials + DPoP). */
  readonly podServiceIssuer: string | undefined;
  /** Confidential client id for the service identity. */
  readonly podServiceClientId: string | undefined;
  /** Confidential client secret for the service identity (server env only). */
  readonly podServiceClientSecret: string | undefined;
  /**
   * Issuers trusted to sign a furnished Repayment-History VC (the fintech
   * lender's identity, plus any future lender's). REQUIRED for the furnish
   * intake to run at all — an empty list fails the whole rail closed (503),
   * never "accept without a check".
   */
  readonly trustedFurnishers: readonly string[];
}

function trimmed(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned === undefined || cleaned === "" ? undefined : cleaned;
}

function splitList(value: string | undefined): readonly string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function bureauConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BureauConfig {
  return {
    issuer: {
      keyJwk: trimmed(env.LENDING_BUREAU_ISSUER_KEY_JWK),
      keyVerificationMethod: trimmed(env.LENDING_BUREAU_ISSUER_KEY_VM),
      statusListUrl: trimmed(env.LENDING_BUREAU_STATUS_LIST_URL),
      webid: trimmed(env.LENDING_BUREAU_ISSUER_WEBID),
    },
    podServiceClientId: trimmed(env.LENDING_BUREAU_POD_SERVICE_CLIENT_ID),
    podServiceClientSecret: trimmed(env.LENDING_BUREAU_POD_SERVICE_CLIENT_SECRET),
    podServiceIssuer: trimmed(env.LENDING_BUREAU_POD_SERVICE_ISSUER),
    serviceWebId: trimmed(env.LENDING_BUREAU_SERVICE_WEBID),
    trustedFurnishers: splitList(env.LENDING_BUREAU_TRUSTED_FURNISHERS),
  };
}

/** A required, non-empty config string — absent values fail closed as 503 upstream. */
export function requiredConfig(value: string | undefined, label: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${label} is unset`);
  }
  return value;
}

/**
 * The same fixed "rail not configured" fail-closed shape
 * @jeswr/solid-pod-guard's own `notConfigured` returns (that helper is not
 * re-exported from the package barrel, so it is mirrored here verbatim —
 * same precedent as the sibling `verifications`/`fintech-lender` apps).
 */
export function notConfigured(detail: string): Response {
  return Response.json(
    {
      detail: `${detail} — this rail fails closed until an operator configures it`,
      error: "not_configured",
      simulated: true,
    },
    { status: 503 },
  );
}
