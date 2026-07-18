import { podRailService } from "../../../../lib/server/service";

/** Scene 5 — read the inspectable repayment-authorization view (1041 rails rendered as data). */
export function POST(request: Request): Promise<Response> {
  return podRailService().servicingRepaymentGrant(request);
}
