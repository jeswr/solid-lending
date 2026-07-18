/**
 * Process-wide service singletons for the route handlers. Constructed ONCE
 * per process: the DPoP verifiers own the jti replay store and JWKS cache,
 * and the nonce store must be shared across the challenge + verify routes —
 * per-request instances would let captured proofs replay.
 */
import { configFromEnv, type FintechLenderConfig } from "./config";
import { createPodRailService, type PodRailService } from "./pod-rail";
import { createPrequalService, type PrequalService } from "./prequal";

let prequal: PrequalService | undefined;
let podRail: PodRailService | undefined;

export function fintechLenderConfig(): FintechLenderConfig {
  return configFromEnv();
}

/** Scene-2 ZK pre-qualification verify service. */
export function prequalService(): PrequalService {
  prequal ??= createPrequalService({ config: fintechLenderConfig() });
  return prequal;
}

/** Scene-3/5 pod routes behind the authenticated-caller boundary. */
export function podRailService(): PodRailService {
  podRail ??= createPodRailService({ config: fintechLenderConfig() });
  return podRail;
}
