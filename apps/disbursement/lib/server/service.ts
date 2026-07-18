/**
 * Process-wide service singletons for the route handlers. Constructed ONCE
 * per process: the DPoP verifier owns the jti replay store and JWKS cache,
 * and the receipt-issuer runtime owns the status-list index allocator — a
 * per-request instance would let a captured DPoP proof replay and would race
 * concurrent status-list creation.
 */
import { configFromEnv, type DisbursementConfig } from "./config";
import { createPayoutRailService, type PayoutRailService } from "./payout-rail";

let payoutRail: PayoutRailService | undefined;

export function disbursementConfig(): DisbursementConfig {
  return configFromEnv();
}

/** Scene-4 pod route behind the authenticated-caller boundary. */
export function payoutRailService(): PayoutRailService {
  payoutRail ??= createPayoutRailService({ config: disbursementConfig() });
  return payoutRail;
}
