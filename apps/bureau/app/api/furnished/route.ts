import { furnishService } from "../../../lib/server/service";

/** GET — the AUTHENTICATED caller's own furnished-tradelines view. */
export async function GET(request: Request): Promise<Response> {
  return furnishService().furnished(request);
}
