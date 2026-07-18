/**
 * The authenticated pod-route boundary for scene 3 (SECURITY-CRITICAL).
 * Every handler:
 *
 *   1. requires a DPoP-bound Solid-OIDC caller — `@jeswr/solid-pod-guard`'s
 *      `createPodRouteGuard` (anonymous ⇒ 401 + `WWW-Authenticate`; caller-
 *      supplied `pod`/`webid` ⇒ 400; unconfigured issuer allowlist ⇒ 503) —
 *      NO simulated bypass exists in server code, in any runtime mode;
 *   2. derives `{webid, podBase}` from the TOKEN (the borrower's OWN
 *      authenticated session), never from request parameters;
 *   3. runs the scene logic over the LENDER'S OWN service-identity pod fetch
 *      (`createServicePodFetch`, client_credentials + DPoP) — the real WAC
 *      grant boundary the pod itself enforces against that identity. There
 *      is NO anonymous fallback: an unconfigured service identity fails
 *      closed (503), and a non-granted or revoked service identity is denied
 *      by the pod (401/403), never silently treated as "no data".
 *
 * Fail-closed invariants (do NOT weaken): unconfigured OIDC-issuer allowlist
 * ⇒ 503; unconfigured service identity ⇒ 503; any binding/grant failure ⇒
 * the pod's own status code (401/403), never a pass; unexpected errors ⇒
 * 500, never approve.
 */
import {
  createPodRouteGuard,
  createServicePodFetch,
  type OwnerBindingSeams,
  PodAccessError,
  type PodRouteGuard,
} from "@jeswr/solid-pod-guard";
import type { BankLenderConfig } from "./config";
import { notConfigured, requiredConfig } from "./config";
import { runOrigination } from "./origination";

export interface PodRailServiceOptions {
  readonly config: BankLenderConfig;
  readonly guard?: PodRouteGuard;
  /** Injected in tests together with {@link serviceWebId} (an account authFetch). */
  readonly podFetch?: typeof fetch;
  readonly serviceWebId?: string;
  readonly now?: () => Date;
  /**
   * Owner-binding seams (the L2 forward-claim profile fetch) — injected in
   * tests. The default `resolveAuthorizedPod` fetch rewrites
   * `https://<loopback>` to `http://<loopback>` for dev issuers that only
   * speak plain HTTP; a test fixture that runs a REAL HTTPS loopback listener
   * (this app's own dev-issuer test fixture) needs that rewrite skipped, not
   * applied, so it injects a plain fetch here instead.
   */
  readonly ownerSeams?: OwnerBindingSeams;
}

export interface PodRailService {
  applicationSubmit(request: Request): Promise<Response>;
}

function errorResponse(error: unknown): Response {
  if (error instanceof PodAccessError) {
    return Response.json(
      { detail: error.message, error: "pod_access", simulated: true },
      { status: error.status },
    );
  }
  if (error instanceof Error && error.message.endsWith("is unset")) {
    return notConfigured(error.message);
  }
  return Response.json({ error: "internal_error", simulated: true }, { status: 500 });
}

export function createPodRailService(options: PodRailServiceOptions): PodRailService {
  const { config } = options;
  const now = options.now ?? (() => new Date());
  const guard =
    options.guard ??
    createPodRouteGuard({
      config,
      ...(options.ownerSeams !== undefined ? { ownerSeams: options.ownerSeams } : {}),
    });

  // Built lazily and cached: the service fetch owns a token cache + DPoP key,
  // and an unconfigured deployment must answer 503 (fail closed), not throw
  // at module load. NO anonymous fallback exists (see the module header).
  let scene: { podFetch: typeof fetch; serviceWebId: string } | undefined;
  const sceneOptions = (): { podFetch: typeof fetch; serviceWebId: string } | Response => {
    if (scene !== undefined) return scene;
    try {
      const serviceWebId = requiredConfig(
        options.serviceWebId ?? config.serviceWebId,
        "LENDING_BANK_SERVICE_WEBID",
      );
      const podFetch =
        options.podFetch ??
        createServicePodFetch({
          allowInsecureLoopback: config.allowInsecureLoopback,
          clientId: requiredConfig(config.podServiceClientId, "LENDING_BANK_POD_SERVICE_CLIENT_ID"),
          clientSecret: requiredConfig(
            config.podServiceClientSecret,
            "LENDING_BANK_POD_SERVICE_CLIENT_SECRET",
          ),
          issuer: requiredConfig(config.podServiceIssuer, "LENDING_BANK_POD_SERVICE_ISSUER"),
        });
      scene = { podFetch, serviceWebId };
      return scene;
    } catch (error) {
      return errorResponse(error);
    }
  };

  return {
    async applicationSubmit(request: Request): Promise<Response> {
      return guard.handle(request, async (caller) => {
        const grant = sceneOptions();
        if (grant instanceof Response) return grant;
        try {
          const report = await runOrigination(caller.podBase, caller.webid, config, {
            now,
            podFetch: grant.podFetch,
            serviceWebId: grant.serviceWebId,
          });
          return Response.json(report);
        } catch (error) {
          return errorResponse(error);
        }
      });
    },
  };
}
