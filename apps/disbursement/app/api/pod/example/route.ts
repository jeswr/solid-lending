import { createPodRouteGuard, type PodRouteGuard } from "@jeswr/solid-pod-guard";
import { configFromEnv } from "../../../../lib/server/config";

/**
 * Sample AUTHENTICATED pod route behind the full fail-closed pipeline:
 * anonymous ⇒ 401 (before any validation), caller-supplied pod/webid ⇒ 400,
 * unconfigured issuer allowlist ⇒ 503, binding failure ⇒ 403 — never pick-first.
 * The app's REAL scene-4 logic is `/api/payout` (`lib/server/payout-rail.ts`);
 * this sample route is kept only as the scaffold's own smoke-tested boundary
 * (`test/pod-guard.test.ts`).
 */
let guard: PodRouteGuard | undefined;

function getGuard(): PodRouteGuard {
  guard ??= createPodRouteGuard({ config: configFromEnv() });
  return guard;
}

export async function POST(request: Request): Promise<Response> {
  return getGuard().handle(request, async (caller) =>
    Response.json({
      simulated: true,
      podBase: caller.podBase,
      webid: caller.webid,
    }),
  );
}
