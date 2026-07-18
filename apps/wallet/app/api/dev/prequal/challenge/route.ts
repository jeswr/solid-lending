import { devSeedAllowed } from "../../../../../lib/server/dev-seed";
import { issueChallenge } from "../../../../../lib/server/prequal-service";

/**
 * Mint a single-use challenge nonce for the scene-2 pre-qualification proof
 * (dev-gated the same way as `/api/dev/seed` — production always refuses;
 * see `../prove/route.ts`'s header for the "who verifies" honesty note).
 */
export async function POST(): Promise<Response> {
  if (!devSeedAllowed()) {
    return Response.json(
      { simulated: true, error: "unavailable", detail: "disabled in production" },
      { status: 404 },
    );
  }
  const challenge = issueChallenge();
  return Response.json({ simulated: true, ...challenge });
}
