import { issuerService } from "../../../lib/server/service";

/**
 * Scene 1 ("fill the vault"): POST `{ flow }` signs one of the four branded
 * issuer flows' credentials — plus its ZK operand anchor where the flow has
 * one — into the AUTHENTICATED caller's Data Vault pod. See
 * `lib/server/issuer-rail.ts` for the full fail-closed contract (real
 * DPoP-bound Solid-OIDC auth, the bidirectional pod binding, no signing
 * oracle, no anonymous pod-IO fallback).
 */
export async function POST(request: Request): Promise<Response> {
  return issuerService().issue(request);
}
