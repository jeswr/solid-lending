import { furnishService } from "../../../lib/server/service";

/**
 * Scene 5 (the credit-graduation close): POST `{ credential }` verifies the
 * fintech lender's Repayment-History VC and records the furnishing. See
 * `lib/server/furnish-rail.ts` for the full fail-closed contract (real
 * DPoP-bound Solid-OIDC auth, real `verifyCredential`, trusted-furnisher
 * allowlist, subject binding — never mocked).
 */
export async function POST(request: Request): Promise<Response> {
  return furnishService().furnish(request);
}
