import { prequalService } from "../../../../lib/server/service";

/** Scene 2 — verify a full pre-qualification presentation (nine fail-closed gates, three legs). */
export function POST(request: Request): Promise<Response> {
  return prequalService().verify(request);
}
