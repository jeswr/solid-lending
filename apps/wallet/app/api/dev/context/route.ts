import { devSeedAllowed, devSeedTarget } from "../../../../lib/server/dev-seed";

/**
 * The dev-seeded pod's coordinates ONLY (never credential values — see
 * `../../../../lib/server/prequal-witness.ts`'s header on why proving/
 * verify-on-view read the pod directly rather than through this app's own
 * server). Dev-gated exactly like `/api/dev/seed`.
 */
export function GET(): Response {
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
  return Response.json({ simulated: true, podBase, webid: target.webid });
}
