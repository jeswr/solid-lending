import { prequalService } from "../../../../lib/server/service";

/** Scene 2 — mint the shared single-use challenge nonce for a pre-qualification presentation. */
export function POST(request: Request): Promise<Response> {
  return prequalService().challenge(request);
}
