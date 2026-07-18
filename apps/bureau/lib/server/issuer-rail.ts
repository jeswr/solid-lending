/**
 * The bureau's authenticated ISSUER boundary (sm-qz3j.5; design §6.1/§6.2,
 * scenes 1 "fill the vault" and 3 "one decision, two models"): POST
 * /api/issue signs the traditional bureau Credit Score VC — the "old rail"
 * the bank-lender's bureau-only decision reads in scene 3 — into the
 * AUTHENTICATED borrower's Data Vault pod, and maintains the bureau's
 * Bitstring revocation list (status = revocation only; re-issue/freshness is
 * a follow-up, out of this round's scope — same known limit as the sibling
 * `verifications` app).
 *
 * Identity and pod location are never accepted from request input:
 * @jeswr/solid-pod-guard's `createPodRouteGuard` DPoP-verifies the caller
 * (L1), derives the pod from the token WebID's bidirectional `pim:storage`
 * binding (L2), and rejects a `pod`/`webid` override at any depth in the
 * query or body (400) BEFORE any pod IO. Claims are the PINNED demo-persona
 * values (./claims.ts, Maya Torres's 612 score) — a request has no
 * selectable or suppliable field, so this route can never become a signing
 * oracle. The issued credential is signed with `subject: caller.webid` (L3
 * — the holder-binding anchor).
 *
 * No ZK operand anchor: the bureau score is disclosed at presentation, never
 * proved by threshold (design §6.2 row 5) — this route issues exactly one
 * pod resource.
 *
 * Pod IO runs over this app's OWN service identity (L4,
 * `createServicePodFetch`) — there is NO anonymous fallback. An unconfigured
 * bureau identity (missing issuer key/WebID/status-list URL) or an
 * unconfigured service identity fails closed with 503 — never open.
 */
import {
  createPodRouteGuard,
  createServicePodFetch,
  PodAccessError,
  type OwnerBindingSeams,
  type PodGuardConfig,
  type PodRouteGuard,
} from "@jeswr/solid-pod-guard";
import {
  ClaimInputError,
  type IssuedCredential,
  IssueRefusedError,
  importKeyPair,
  issueCredential,
  type KeyPair,
  StatusIndexAllocator,
  StatusListClient,
  StatusListError,
} from "@lending/vc-kit";
import {
  CREDIT_SCORE_CREDENTIAL_PATH,
  CREDIT_SCORE_VALID_FROM_DAYS,
  CREDIT_SCORE_VALID_UNTIL_DAYS,
  creditScoreClaims,
} from "./claims";
import { type BureauConfig, notConfigured, requiredConfig } from "./config";
import { createPodTurtle, podResourceExists, type PodIoFetch } from "./pod-io";
import { publicRequestUrl as defaultPublicRequestUrl } from "./url";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

export interface IssuerServiceOptions {
  readonly guardConfig: PodGuardConfig;
  readonly config: BureauConfig;
  /** Owner-binding seams (profile fetch) for tests. */
  readonly ownerSeams?: OwnerBindingSeams;
  /** Public-URL reconstruction for the DPoP `htu` binding. Defaults to this app's basePath. */
  readonly publicRequestUrl?: (request: Request) => string;
  /** Injected in tests: writes to the caller's pod. Defaults to the L4 service identity. */
  readonly podFetch?: PodIoFetch;
  /**
   * Injected in tests: reads/writes the bureau's hosted status list. Default:
   * the same service-identity fetch as the pod IO.
   */
  readonly statusHostFetch?: typeof fetch;
  /** Injected bureau signing key (tests). Falls back to the env private JWK. */
  readonly key?: KeyPair;
  readonly now?: () => Date;
}

export interface IssuerService {
  /** POST — scene 1: issue the Credit Score VC into the caller's pod. */
  issue(request: Request): Promise<Response>;
}

function errorResponse(error: unknown): Response {
  if (error instanceof PodAccessError) {
    return Response.json(
      { detail: error.message, error: "pod_access", simulated: true },
      { status: error.status },
    );
  }
  if (error instanceof StatusListError) {
    return Response.json(
      { detail: error.message, error: "status_list", simulated: true },
      { status: 502 },
    );
  }
  if (error instanceof Error && error.message.endsWith("is unset")) {
    return notConfigured(error.message);
  }
  if (error instanceof IssueRefusedError || error instanceof ClaimInputError) {
    // Pinned demo claims failing their own shape is a SERVER defect — surface
    // as 500 without echoing graph internals.
    return Response.json({ error: "issuance_defect", simulated: true }, { status: 500 });
  }
  return Response.json({ error: "internal_error", simulated: true }, { status: 500 });
}

interface IssuedSummary {
  readonly id: string;
  readonly kind: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly statusListCredential: string;
  readonly statusListIndex: string | undefined;
}

interface Validity {
  readonly validFrom: Date;
  readonly validUntil: Date;
}

function summarize(issued: IssuedCredential, statusListUrl: string, validity: Validity) {
  return {
    id: issued.credentialId,
    kind: issued.kind,
    statusListCredential: statusListUrl,
    statusListIndex: issued.status?.statusListIndex,
    validFrom: validity.validFrom.toISOString(),
    validUntil: validity.validUntil.toISOString(),
  } satisfies IssuedSummary;
}

const STATUS_LIST_VALID_DAYS = 400;

interface BureauRuntime {
  readonly issuerWebId: string;
  readonly key: KeyPair;
  readonly statusList: StatusListClient;
  readonly allocator: StatusIndexAllocator;
}

export function createIssuerService(options: IssuerServiceOptions): IssuerService {
  const { guardConfig, config } = options;

  // Built lazily and cached: the service fetch owns a token cache + DPoP key,
  // and an unconfigured deployment must answer 503 (fail closed), not throw
  // at module load. NO anonymous fallback exists (see the module header).
  let servicePodFetch: PodIoFetch | undefined;
  function getPodFetch(): PodIoFetch | Response {
    if (servicePodFetch !== undefined) return servicePodFetch;
    if (options.podFetch !== undefined) {
      servicePodFetch = options.podFetch;
      return servicePodFetch;
    }
    try {
      servicePodFetch = createServicePodFetch({
        allowInsecureLoopback: guardConfig.allowInsecureLoopback,
        clientId: requiredConfig(config.podServiceClientId, "LENDING_BUREAU_POD_SERVICE_CLIENT_ID"),
        clientSecret: requiredConfig(
          config.podServiceClientSecret,
          "LENDING_BUREAU_POD_SERVICE_CLIENT_SECRET",
        ),
        issuer: requiredConfig(config.podServiceIssuer, "LENDING_BUREAU_POD_SERVICE_ISSUER"),
      });
      return servicePodFetch;
    } catch (error) {
      return errorResponse(error);
    }
  }

  function getStatusHostFetch(): typeof fetch | Response {
    return options.statusHostFetch ?? getPodFetch();
  }

  let runtime: Promise<BureauRuntime | Response> | undefined;
  function getRuntime(): Promise<BureauRuntime | Response> {
    runtime ??= (async () => {
      const statusHostFetch = getStatusHostFetch();
      if (statusHostFetch instanceof Response) return statusHostFetch;
      try {
        const issuerWebId = requiredConfig(config.issuer.webid, "LENDING_BUREAU_ISSUER_WEBID");
        const statusListUrl = requiredConfig(
          config.issuer.statusListUrl,
          "LENDING_BUREAU_STATUS_LIST_URL",
        );
        let key = options.key;
        if (key === undefined) {
          const keyJwk = requiredConfig(config.issuer.keyJwk, "LENDING_BUREAU_ISSUER_KEY_JWK");
          const verificationMethod =
            config.issuer.keyVerificationMethod ?? `${issuerWebId.split("#")[0]}#vc-key`;
          key = await importKeyPair(verificationMethod, JSON.parse(keyJwk));
        }
        return {
          allocator: new StatusIndexAllocator(),
          issuerWebId,
          key,
          statusList: new StatusListClient({
            fetch: statusHostFetch,
            issuer: issuerWebId,
            key,
            url: statusListUrl,
          }),
        } satisfies BureauRuntime;
      } catch (error) {
        if (error instanceof Error && error.message.endsWith("is unset")) {
          return notConfigured(error.message);
        }
        // A malformed key JWK must not leak its contents into the response.
        return notConfigured("LENDING_BUREAU_ISSUER_KEY_JWK could not be imported");
      }
    })();
    return runtime;
  }

  /** Create the hosted list on first use. Absent -> all-clear signed list; present -> no-op. */
  async function ensureStatusList(
    statusList: StatusListClient,
    statusHostFetch: typeof fetch,
    now: Date,
  ): Promise<void> {
    const probe = await statusHostFetch(statusList.url, {
      headers: { accept: "application/vc+ld+json, application/json;q=0.9" },
    });
    if (probe.status === 404) {
      await statusList.create({ now, validUntil: daysFrom(now, STATUS_LIST_VALID_DAYS) });
      return;
    }
    if (!probe.ok) {
      throw new StatusListError(`status list probe GET ${statusList.url} failed: ${probe.status}`);
    }
  }

  const guard: PodRouteGuard = createPodRouteGuard({
    config: guardConfig,
    ...(options.ownerSeams !== undefined ? { ownerSeams: options.ownerSeams } : {}),
    publicRequestUrl: options.publicRequestUrl ?? defaultPublicRequestUrl,
  });

  return {
    async issue(request) {
      return guard.handle(request, async (caller) => {
        const podFetch = getPodFetch();
        if (podFetch instanceof Response) return podFetch;
        const statusHostFetch = getStatusHostFetch();
        if (statusHostFetch instanceof Response) return statusHostFetch;
        const bureau = await getRuntime();
        if (bureau instanceof Response) return bureau;
        const now = options.now?.() ?? new Date();

        try {
          const credentialIri = `${caller.podBase}${CREDIT_SCORE_CREDENTIAL_PATH.slice(1)}`;

          // Scene-1 issuance is a strict CREATE: an already-present resource
          // means this credential was already issued — an operator/scripted
          // revoke-then-reissue is required to replace it (the freshness
          // re-issue rail is a follow-up, see the module header).
          if (await podResourceExists(credentialIri, podFetch)) {
            return Response.json(
              {
                detail: "the Credit Score VC already exists in this borrower's vault",
                error: "already_issued",
                simulated: true,
              },
              { status: 409 },
            );
          }

          await ensureStatusList(bureau.statusList, statusHostFetch, now);

          const validity: Validity = {
            validFrom: daysFrom(now, CREDIT_SCORE_VALID_FROM_DAYS),
            validUntil: daysFrom(now, CREDIT_SCORE_VALID_UNTIL_DAYS),
          };
          const index = bureau.allocator.allocate(credentialIri);
          const issued = await issueCredential({
            claims: creditScoreClaims(),
            credentialId: credentialIri,
            issuer: bureau.issuerWebId,
            key: bureau.key,
            kind: "credit-score-credential",
            status: bureau.statusList.entry(index),
            subject: caller.webid,
            validity,
          });

          await createPodTurtle(credentialIri, issued.body, podFetch);

          return Response.json({
            credential: summarize(issued, bureau.statusList.url, validity),
            simulated: true,
          });
        } catch (error) {
          return errorResponse(error);
        }
      });
    },
  };
}
