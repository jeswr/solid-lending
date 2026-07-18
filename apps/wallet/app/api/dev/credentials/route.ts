import { devSeedAllowed, devSeedTarget } from "../../../../lib/server/dev-seed";
import { readCredentialSummaries } from "../../../../lib/server/credential-summary";

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
  const podBase = target.podUrl.endsWith("/") ? target.podUrl : `${target.podUrl}/`;
  const credentials = await readCredentialSummaries({ podBase, now: new Date() });
  return Response.json({ simulated: true, credentials });
}
