import { createServicePodFetch } from "@jeswr/solid-pod-guard";
import { devSeedAllowed, devSeedTarget } from "../../../../lib/server/dev-seed";
import { readCredentialSummaries } from "../../../../lib/server/credential-summary";
import { requiredConfig, walletGrantConfig } from "../../../../lib/server/config";

/**
 * The wallet's OWN service-identity pod fetch (client_credentials + DPoP,
 * `@jeswr/solid-pod-guard`'s `createServicePodFetch` — the SAME seam
 * `wallet-grant-service.ts` builds for the grant rail): each credential's
 * ACL grants `wallet-service` Read/Write/Control explicitly, so this is what
 * verify-on-view actually reads through — the pod runs real Solid-OIDC +
 * DPoP verification, never an unauthenticated-owner bypass. Built lazily and
 * cached (module scope): the service fetch owns a token cache + DPoP key, and
 * an unconfigured deployment must answer 503 (fail closed), not throw at
 * module load.
 */
let podFetch: typeof fetch | undefined;
function getPodFetch(): typeof fetch {
  if (podFetch !== undefined) return podFetch;
  const config = walletGrantConfig();
  podFetch = createServicePodFetch({
    allowInsecureLoopback: config.guard.allowInsecureLoopback,
    clientId: requiredConfig(config.podServiceClientId, "LENDING_WALLET_POD_SERVICE_CLIENT_ID"),
    clientSecret: requiredConfig(
      config.podServiceClientSecret,
      "LENDING_WALLET_POD_SERVICE_CLIENT_SECRET",
    ),
    issuer: requiredConfig(config.podServiceIssuer, "LENDING_WALLET_POD_SERVICE_ISSUER"),
  });
  return podFetch;
}

/** Verify-on-view (browser-triggered, server-executed — see
 * `../../../../lib/server/credential-summary.ts`'s header) for the vault's
 * credential list. Dev-gated exactly like `/api/dev/seed`. */
export async function GET(): Promise<Response> {
  if (!devSeedAllowed()) {
    return Response.json(
      { simulated: true, error: "unavailable", detail: "disabled in production" },
      { status: 404 },
    );
  }
  const target = devSeedTarget();
  if (target === undefined) {
    return Response.json(
      {
        simulated: true,
        error: "not_configured",
        detail: "set LENDING_SEED_POD_URL and LENDING_SEED_WEBID (see .env.example)",
      },
      { status: 503 },
    );
  }
  let servicePodFetch: typeof fetch;
  try {
    servicePodFetch = getPodFetch();
  } catch (error) {
    return Response.json(
      {
        simulated: true,
        error: "not_configured",
        detail: `${(error as Error).message} — this rail fails closed until an operator configures it`,
      },
      { status: 503 },
    );
  }
  const podBase = target.podUrl.endsWith("/") ? target.podUrl : `${target.podUrl}/`;
  const credentials = await readCredentialSummaries({
    podBase,
    now: new Date(),
    podFetch: servicePodFetch,
  });
  return Response.json({ simulated: true, credentials });
}
