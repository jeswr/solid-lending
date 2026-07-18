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
