import { guardConfig, issuersConfigFromEnv } from "./config";
import { createIssuerService, type IssuerService } from "./issuer-rail";

/** Process singleton: the verifier owns the DPoP replay cache and must not be per-request. */
let service: IssuerService | undefined;

export function issuerService(): IssuerService {
  service ??= createIssuerService({
    guardConfig: guardConfig(),
    issuers: issuersConfigFromEnv(),
  });
  return service;
}
