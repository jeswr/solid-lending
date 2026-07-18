import { podRailService } from "../../../../lib/server/service";

/** Scene 5 — the graduation beat: furnish the repayment-history credential toward the bureau. */
export function POST(request: Request): Promise<Response> {
  return podRailService().servicingFurnishHistory(request);
}
