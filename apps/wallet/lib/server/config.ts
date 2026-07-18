import { configFromEnv, type PodGuardConfig } from "@jeswr/solid-pod-guard";
import { GRANT_PARTIES, GRANT_PARTY_IDS, type GrantPartyId } from "../grants/parties";

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

/**
 * The vault's Mode-2 grant-rail config (design §6.1/§6.2): the pod-guard base
 * config PLUS the wallet's own service identity (decision-0015-style L4,
 * carried over from the mortgage showcase) and the OPERATOR-PINNED party
 * WebIDs a grant may ever target. Everything here fails closed: an unset
 * party is simply absent from the dashboard; an unset service identity
 * answers 503 on any grant-rail route (never falls back to anonymous IO).
 */
export interface WalletGrantConfig {
  readonly guard: PodGuardConfig;
  /** The wallet's OWN service WebID, kept in every rebuilt ACL. */
  readonly serviceWebId: string | undefined;
  readonly podServiceIssuer: string | undefined;
  readonly podServiceClientId: string | undefined;
  readonly podServiceClientSecret: string | undefined;
  readonly partyWebIds: Partial<Record<GrantPartyId, string>>;
}

export function walletGrantConfig(env: NodeJS.ProcessEnv = process.env): WalletGrantConfig {
  const partyWebIds: Partial<Record<GrantPartyId, string>> = {};
  for (const party of GRANT_PARTY_IDS) {
    const value = env[GRANT_PARTIES[party].envVar];
    if (value !== undefined && value.trim() !== "") partyWebIds[party] = value.trim();
  }
  return {
    guard: configFromEnv(ENV_PREFIX, env),
    serviceWebId: env.LENDING_WALLET_SERVICE_WEBID,
    podServiceIssuer: env.LENDING_WALLET_POD_SERVICE_ISSUER,
    podServiceClientId: env.LENDING_WALLET_POD_SERVICE_CLIENT_ID,
    podServiceClientSecret: env.LENDING_WALLET_POD_SERVICE_CLIENT_SECRET,
    partyWebIds,
  };
}

/** A required, non-empty config string — absent values fail closed as 503 upstream. */
export function requiredConfig(value: string | undefined, label: string): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${label} is unset`);
  }
  return value;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A configured agent WebID: https (loopback http in dev only), no userinfo. */
export function configuredAgent(
  value: string | undefined,
  label: string,
  allowInsecureLoopback = false,
): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${label} is unset`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute WebID URL`);
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  const transportAllowed =
    url.protocol === "https:" || (allowInsecureLoopback && loopback && url.protocol === "http:");
  if (!transportAllowed || url.username !== "" || url.password !== "") {
    throw new Error(`${label} must be an https WebID without userinfo (loopback http in dev only)`);
  }
  return url.href;
}
