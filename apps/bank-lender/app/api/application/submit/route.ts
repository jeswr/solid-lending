import { podRailService } from "../../../../lib/server/service";

/**
 * Scene 3 — the signature CONTRAST beat: read the borrower's GRANTED
 * credit-score credential over this lender's own service identity, run the
 * BUREAU-ONLY decision, and deliver a Reg B adverse-action notice (decline)
 * or a Reg Z closed-end offer (approve) into the pod.
 */
export function POST(request: Request): Promise<Response> {
  return podRailService().applicationSubmit(request);
}
