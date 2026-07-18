import { devSeedAllowed, devSeedTarget } from "../../../../../lib/server/dev-seed";
import { PreQualServiceError, proveAndVerify } from "../../../../../lib/server/prequal-service";

/**
 * `POST { sessionKey, nonce }` — prove the scene-2 pre-qualification
 * conjunction over the dev-seeded pod's verified credentials, then
 * immediately verify the proof produced. Dev-gated (mirrors `/api/dev/seed`):
 * refuses in production and when no seed target is configured — never picks
 * a default pod. See `../../../../../lib/server/prequal-service.ts`'s header
 * for the "this rail also stands in as the verifier" honesty note (no live
 * lender rail exists yet in this repo to VP-POST to).
 */
export async function POST(request: Request): Promise<Response> {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { simulated: true, error: "malformed_request", detail: "body must be JSON" },
      { status: 400 },
    );
  }
  if (typeof body !== "object" || body === null) {
    return Response.json(
      { simulated: true, error: "malformed_request", detail: "body must be a JSON object" },
      { status: 400 },
    );
  }
  const { sessionKey, nonce } = body as Record<string, unknown>;
  if (typeof sessionKey !== "string" || typeof nonce !== "string") {
    return Response.json(
      {
        simulated: true,
        error: "malformed_request",
        detail: "body.sessionKey and body.nonce must be strings",
      },
      { status: 400 },
    );
  }

  const podBase = target.podUrl.endsWith("/") ? target.podUrl : `${target.podUrl}/`;
  try {
    const result = await proveAndVerify({
      podBase,
      webid: target.webid,
      sessionKey,
      nonce,
      now: new Date(),
    });
    return Response.json({
      simulated: true,
      verified: result.verification.verified,
      errors: result.verification.errors,
      proveMs: result.proveMs,
    });
  } catch (error) {
    if (error instanceof PreQualServiceError) {
      return Response.json(
        { simulated: true, error: "prequal_failed", detail: error.message },
        { status: error.status },
      );
    }
    return Response.json({ simulated: true, error: "internal_error" }, { status: 500 });
  }
}
