import { getWalletGrantService } from "../../../lib/server/wallet-service-instance";

/**
 * The scene-5 consent-receipt + ODRL grant ledger: the wallet's authoritative
 * `/lending/receipts/` records plus any root-level records other apps in the
 * journey have written, time-ordered. Real auth — anonymous ⇒ 401.
 */
export async function GET(request: Request): Promise<Response> {
  return getWalletGrantService().ledger(request);
}
