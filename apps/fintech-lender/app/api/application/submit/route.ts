import { podRailService } from "../../../../lib/server/service";

/**
 * Scene 3 — the signature beat: read the borrower's GRANTED loan file over
 * this lender's own service identity, run the two-model (bureau-only vs
 * cash-flow-plus) decision, and deliver the Reg Z disclosure + funding
 * instruction into the pod on approval.
 */
export function POST(request: Request): Promise<Response> {
  return podRailService().applicationSubmit(request);
}
