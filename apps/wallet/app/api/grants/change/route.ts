import { getWalletGrantService } from "../../../../lib/server/wallet-service-instance";

/**
 * `POST { party, resource, action }` — grant or revoke one party's access to
 * one catalogue resource. Real auth: anonymous ⇒ 401, `pod`/`webid` overrides
 * (query or body, any depth) ⇒ 400, the party's WebID is OPERATOR-PINNED env
 * config (never request-supplied), revocation is immutable, repeats are loud
 * 409 no-ops.
 */
export async function POST(request: Request): Promise<Response> {
  return getWalletGrantService().changeGrant(request);
}
