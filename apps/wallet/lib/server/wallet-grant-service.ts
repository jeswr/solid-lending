/**
 * The vault's Mode-2 grant boundary (design §6.1/§6.2; adapted from the
 * solid-mortgage showcase's wallet rail, jeswr/solid-mortgage — read-only
 * reference). Identity and pod are NEVER accepted from request input:
 * `@jeswr/solid-pod-guard`'s `createPodRouteGuard` owns the full L1
 * (DPoP-verified caller, anonymous ⇒ 401) + L2 (pod derived from the token
 * WebID's bidirectional `pim:storage` binding; `pod`/`webid` overrides ⇒ 400)
 * pipeline verbatim — this module only adds the grant-specific L4 (the
 * wallet's OWN service identity for WAC-protected pod IO; unconfigured ⇒ 503,
 * never an anonymous fallback) and the grant catalogue itself (a request may
 * only name an OPERATOR-CONFIGURED party WebID, resolved from a party id —
 * never a request-supplied WebID).
 */
import {
  createPodRouteGuard,
  createServicePodFetch,
  PodAccessError,
  type PodRouteGuard,
} from "@jeswr/solid-pod-guard";
import {
  changeResourceAccess,
  type GrantEngineOptions,
  readConsentLedger,
  readGrantStandings,
} from "../grants/engine";
import type { PodIoFetch } from "../grants/pod-io";
import {
  GRANT_PARTIES,
  GRANT_PARTY_IDS,
  type GrantPartyId,
  isGrantPartyId,
  partyResourceModes,
} from "../grants/parties";
import { isResourceId, RESOURCE_CATALOG, type ResourceId } from "../grants/resources";
import { configuredAgent, requiredConfig, type WalletGrantConfig } from "./config";
import { publicRequestUrl as defaultPublicRequestUrl } from "./url";

export interface WalletGrantServiceOptions {
  readonly config: WalletGrantConfig;
  readonly guard?: PodRouteGuard;
  /** Injected in tests together with {@link serviceWebId}. */
  readonly podFetch?: PodIoFetch;
  readonly serviceWebId?: string;
  readonly now?: () => Date;
  /** Public-URL reconstruction for the DPoP `htu` binding. Defaults to this app's basePath. */
  readonly publicRequestUrl?: (request: Request) => string;
}

export interface WalletGrantService {
  /** GET — the access-grant dashboard (configured parties + live standing). */
  grants(request: Request): Promise<Response>;
  /** POST `{ party, resource, action }` — create or revoke one grant. */
  changeGrant(request: Request): Promise<Response>;
  /** GET — the full consent-receipt ledger. */
  ledger(request: Request): Promise<Response>;
}

/** Mirrors `@jeswr/solid-pod-guard`'s own fail-closed "not configured" shape
 * (that helper is internal to the package — not part of its public export
 * surface — so this app reproduces the documented response verbatim). */
function notConfigured(detail: string): Response {
  return Response.json(
    {
      simulated: true,
      error: "not_configured",
      detail: `${detail} — this rail fails closed until an operator configures it`,
    },
    { status: 503 },
  );
}

function errorResponse(error: unknown): Response {
  if (error instanceof PodAccessError) {
    return Response.json(
      { simulated: true, error: "pod_access", detail: error.message },
      { status: error.status },
    );
  }
  if (error instanceof Error && error.message.endsWith("is unset")) {
    return notConfigured(error.message);
  }
  return Response.json({ simulated: true, error: "internal_error" }, { status: 500 });
}

function badRequest(detail: string): Response {
  return Response.json({ simulated: true, error: "malformed_request", detail }, { status: 400 });
}

export function createWalletGrantService(options: WalletGrantServiceOptions): WalletGrantService {
  const { config } = options;
  const guard =
    options.guard ??
    createPodRouteGuard({
      config: config.guard,
      publicRequestUrl: options.publicRequestUrl ?? defaultPublicRequestUrl,
    });

  let engine: GrantEngineOptions | undefined;
  const engineOptions = (): GrantEngineOptions | Response => {
    if (engine !== undefined) return engine;
    try {
      const serviceWebId =
        options.serviceWebId ??
        configuredAgent(
          config.serviceWebId,
          "LENDING_WALLET_SERVICE_WEBID",
          config.guard.allowInsecureLoopback,
        );
      const podFetch =
        options.podFetch ??
        createServicePodFetch({
          issuer: requiredConfig(config.podServiceIssuer, "LENDING_WALLET_POD_SERVICE_ISSUER"),
          clientId: requiredConfig(
            config.podServiceClientId,
            "LENDING_WALLET_POD_SERVICE_CLIENT_ID",
          ),
          clientSecret: requiredConfig(
            config.podServiceClientSecret,
            "LENDING_WALLET_POD_SERVICE_CLIENT_SECRET",
          ),
          allowInsecureLoopback: config.guard.allowInsecureLoopback,
        });
      engine = {
        podFetch,
        serviceWebId,
        ...(options.now === undefined ? {} : { now: options.now }),
      };
      return engine;
    } catch (error) {
      return errorResponse(error);
    }
  };

  function configuredParties(): {
    id: GrantPartyId;
    label: string;
    webid: string;
    resources: readonly ResourceId[];
  }[] {
    return GRANT_PARTY_IDS.flatMap((id) => {
      const webid = config.partyWebIds[id];
      return webid === undefined
        ? []
        : [
            {
              id,
              label: GRANT_PARTIES[id].label,
              webid,
              resources: GRANT_PARTIES[id].resources.map((entry) => entry.resource),
            },
          ];
    });
  }

  return {
    async grants(request) {
      return guard.handle(request, async (caller) => {
        const engineResult = engineOptions();
        if (engineResult instanceof Response) return engineResult;
        try {
          const parties = configuredParties();
          const resources = [...new Set(parties.flatMap((party) => party.resources))];
          const standings = await readGrantStandings(
            caller.podBase,
            caller.webid,
            resources,
            engineResult,
          );
          return Response.json({ simulated: true, parties, standings });
        } catch (error) {
          return errorResponse(error);
        }
      });
    },

    async changeGrant(request) {
      return guard.handle(request, async (caller, body) => {
        const { party, resource, action } = body;
        if (typeof party !== "string" || !isGrantPartyId(party)) {
          return badRequest(`body.party must be one of: ${GRANT_PARTY_IDS.join(", ")}`);
        }
        if (typeof resource !== "string" || !isResourceId(resource)) {
          return badRequest(
            `body.resource must be one of: ${Object.keys(RESOURCE_CATALOG).join(", ")}`,
          );
        }
        if (action !== "grant" && action !== "revoke") {
          return badRequest('body.action must be "grant" or "revoke"');
        }
        // The catalogue is CLOSED — an off-catalogue (party, resource) pair is
        // refused before any pod IO (the party may simply never be granted it).
        const grant = partyResourceModes(party, resource);
        if (grant === undefined) {
          return badRequest(`${party} may never be granted ${resource}`);
        }
        const definition = GRANT_PARTIES[party];
        const engineResult = engineOptions();
        if (engineResult instanceof Response) return engineResult;
        try {
          // The party's WebID is OPERATOR-PINNED env config — a grant route
          // never materialises WAC for a request-supplied agent.
          const agent = configuredAgent(
            config.partyWebIds[party],
            definition.envVar,
            config.guard.allowInsecureLoopback,
          );
          const receipt = await changeResourceAccess(
            caller.podBase,
            caller.webid,
            agent,
            resource,
            action,
            { write: grant.write },
            engineResult,
          );
          return Response.json({ simulated: true, party, resource, receipt });
        } catch (error) {
          return errorResponse(error);
        }
      });
    },

    async ledger(request) {
      return guard.handle(request, async (caller) => {
        const engineResult = engineOptions();
        if (engineResult instanceof Response) return engineResult;
        try {
          return Response.json({
            simulated: true,
            receipts: await readConsentLedger(caller.podBase, caller.webid, engineResult),
          });
        } catch (error) {
          return errorResponse(error);
        }
      });
    },
  };
}
