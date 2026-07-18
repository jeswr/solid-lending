import { getWalletGrantService } from "../../../lib/server/wallet-service-instance";

/**
 * The access-grant dashboard (design §6.1/§6.2 scenes 1/3/4/5): every
 * OPERATOR-CONFIGURED party plus this pod's live standing per grantable
 * resource. Real auth (`@jeswr/solid-pod-guard`) — anonymous ⇒ 401.
 */
export async function GET(request: Request): Promise<Response> {
  return getWalletGrantService().grants(request);
}
