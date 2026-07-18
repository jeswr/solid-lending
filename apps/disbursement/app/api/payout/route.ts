import { payoutRailService } from "../../../lib/server/service";

/**
 * Scene 4 — the signature beat: read the borrower's GRANTED loan offer over
 * this rail's own service identity, verify it fail-closed, run the
 * deterministic simulated push-to-card payout, and sign + deliver the
 * Disbursement Receipt VC into the pod.
 */
export function POST(request: Request): Promise<Response> {
  return payoutRailService().payout(request);
}
