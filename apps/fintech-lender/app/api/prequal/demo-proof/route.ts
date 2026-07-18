import { prequalService } from "../../../../lib/server/service";

/**
 * Demo-only: produce a REAL ZK proof + REAL signed anchors over Maya's
 * pinned witness, bound to a live challenge (see `lib/server/demo-issuer.ts`
 * for the honesty framing). Stands in for the wallet's own pod-read + in-
 * browser proving UX in this app's standalone walkthrough.
 */
export function POST(request: Request): Promise<Response> {
  return prequalService().demoProof(request);
}
