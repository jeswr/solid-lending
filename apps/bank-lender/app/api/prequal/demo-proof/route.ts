import { prequalService } from "../../../../lib/server/service";

/** Scene 2 demo convenience — produce a REAL proof bundle over Maya's pinned witness, bound to the caller's live nonce. */
export function POST(request: Request): Promise<Response> {
  return prequalService().demoProof(request);
}
