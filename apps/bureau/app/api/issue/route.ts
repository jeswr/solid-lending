import { issuerService } from "../../../lib/server/service";

/**
 * Scene 1 ("fill the vault") / scene 3 ("one decision, two models"): POST
 * signs the traditional bureau Credit Score VC — the "old rail" — into the
 * AUTHENTICATED caller's Data Vault pod. See `lib/server/issuer-rail.ts` for
 * the full fail-closed contract (real DPoP-bound Solid-OIDC auth, the
 * bidirectional pod binding, no signing oracle, no anonymous pod-IO
 * fallback).
 */
export async function POST(request: Request): Promise<Response> {
  return issuerService().issue(request);
}
