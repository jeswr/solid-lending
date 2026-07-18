import { bureauConfigFromEnv, guardConfig } from "./config";
import { createFurnishService, type FurnishService } from "./furnish-rail";
import { createIssuerService, type IssuerService } from "./issuer-rail";

/** Process singletons: each service owns the DPoP replay cache and must not be per-request. */
let issuer: IssuerService | undefined;
let furnisher: FurnishService | undefined;

export function issuerService(): IssuerService {
  issuer ??= createIssuerService({
    config: bureauConfigFromEnv(),
    guardConfig: guardConfig(),
  });
  return issuer;
}

export function furnishService(): FurnishService {
  furnisher ??= createFurnishService({
    guardConfig: guardConfig(),
    trustedFurnishers: bureauConfigFromEnv().trustedFurnishers,
  });
  return furnisher;
}
