import { createWalletGrantService, type WalletGrantService } from "./wallet-grant-service";
import { walletGrantConfig } from "./config";

/**
 * Module-scope singleton (construct ONCE): the guard owns the DPoP verifier's
 * issuer discovery, JWKS cache, and jti replay store — a per-request instance
 * would let a captured DPoP proof replay cleanly (`@jeswr/solid-pod-guard`
 * SKILL.md).
 */
let service: WalletGrantService | undefined;

export function getWalletGrantService(): WalletGrantService {
  service ??= createWalletGrantService({ config: walletGrantConfig() });
  return service;
}
