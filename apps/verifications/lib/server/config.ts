/**
 * Server-side configuration for the verifications ISSUER rails (sm-qz3j.5;
 * design §6.1/§6.2 scene 1 "fill the vault"). This app is the SUPPLIER side
 * of the journey: four branded issuer flows (Socure-modelled identity,
 * The-Work-Number-modelled employment+income, Mastercard-Open-Banking-modelled
 * bank cash-flow, Prism-Data-modelled cash-flow score) sign VCs into the
 * borrower's Data Vault pod and maintain one Bitstring revocation list per
 * flow.
 *
 * The pod-route boundary itself (DPoP-bound auth, the bidirectional
 * pim:storage pod binding, pod/webid override rejection) is
 * @jeswr/solid-pod-guard's `configFromEnv`/`createPodRouteGuard` — see
 * `guardConfig()` below. The PER-FLOW issuer identity (signing key, WebID,
 * hosted status list) and this app's OWN service identity (L4 pod IO) are
 * this app's own extension, read here. Everything fails closed: an unset
 * issuer key/WebID/status-list URL disables that flow (503) rather than
 * opening it, and issuer signing keys are private JWKs in server env — they
 * never reach a client bundle.
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

/** The four branded issuer flows (design §6.2, scene 1 "fill the vault"). */
export const ISSUER_FLOW_IDS = ["identity", "income", "cashflow", "score"] as const;

export type IssuerFlowId = (typeof ISSUER_FLOW_IDS)[number];

export function isIssuerFlowId(value: string): value is IssuerFlowId {
  return (ISSUER_FLOW_IDS as readonly string[]).includes(value);
}

/** Per-flow issuer identity configuration (operator env; see the env table below). */
export interface IssuerIdentityConfig {
  /** The issuing organisation's WebID (must publish the verification method). */
  readonly webid: string | undefined;
  /** The issuer's private signing JWK (Ed25519, `eddsa-rdfc-2022`) as JSON. */
  readonly keyJwk: string | undefined;
  /** The key's verification-method IRI. Default: `<webid document>#vc-key`. */
  readonly keyVerificationMethod: string | undefined;
  /** The issuer's hosted Bitstring revocation list URL. */
  readonly statusListUrl: string | undefined;
}

export interface VerificationsIssuersConfig {
  /** The app's OWN service WebID (L4) — the agent a borrower's grant names for pod IO. */
  readonly serviceWebId: string | undefined;
  /** OIDC issuer of the service identity (client_credentials + DPoP). */
  readonly podServiceIssuer: string | undefined;
  /** Confidential client id for the service identity. */
  readonly podServiceClientId: string | undefined;
  /** Confidential client secret for the service identity (server env only). */
  readonly podServiceClientSecret: string | undefined;
  /** Per-flow issuer identities. */
  readonly issuers: Readonly<Record<IssuerFlowId, IssuerIdentityConfig>>;
}

const FLOW_ENV_PREFIX: Readonly<Record<IssuerFlowId, string>> = {
  cashflow: "LENDING_VERIFICATIONS_CASHFLOW",
  identity: "LENDING_VERIFICATIONS_IDENTITY",
  income: "LENDING_VERIFICATIONS_INCOME",
  score: "LENDING_VERIFICATIONS_SCORE",
};

/** The env-var name for one flow's issuer setting (README env table). */
export function flowEnvVar(
  flow: IssuerFlowId,
  setting: "ISSUER_WEBID" | "ISSUER_KEY_JWK" | "ISSUER_KEY_VM" | "STATUS_LIST_URL",
): string {
  return `${FLOW_ENV_PREFIX[flow]}_${setting}`;
}

function trimmed(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned === undefined || cleaned === "" ? undefined : cleaned;
}

export function issuersConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): VerificationsIssuersConfig {
  const issuers = Object.fromEntries(
    ISSUER_FLOW_IDS.map((flow) => [
      flow,
      {
        keyJwk: trimmed(env[flowEnvVar(flow, "ISSUER_KEY_JWK")]),
        keyVerificationMethod: trimmed(env[flowEnvVar(flow, "ISSUER_KEY_VM")]),
        statusListUrl: trimmed(env[flowEnvVar(flow, "STATUS_LIST_URL")]),
        webid: trimmed(env[flowEnvVar(flow, "ISSUER_WEBID")]),
      } satisfies IssuerIdentityConfig,
    ]),
  ) as Record<IssuerFlowId, IssuerIdentityConfig>;
  return {
    issuers,
    podServiceClientId: trimmed(env.LENDING_VERIFICATIONS_POD_SERVICE_CLIENT_ID),
    podServiceClientSecret: trimmed(env.LENDING_VERIFICATIONS_POD_SERVICE_CLIENT_SECRET),
    podServiceIssuer: trimmed(env.LENDING_VERIFICATIONS_POD_SERVICE_ISSUER),
    serviceWebId: trimmed(env.LENDING_VERIFICATIONS_SERVICE_WEBID),
  };
}

/** A required, non-empty config string — absent values fail closed as 503 upstream. */
export function requiredConfig(value: string | undefined, label: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${label} is unset`);
  }
  return value;
}
