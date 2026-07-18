/**
 * The verifications app's authenticated ISSUER boundary (sm-qz3j.5; design
 * §6.1/§6.2, scene 1 "fill the vault"): POST /api/issue signs one of the
 * four branded flows' credentials — PLUS its ZK operand anchor where the
 * flow has one — into the AUTHENTICATED borrower's Data Vault pod, and
 * maintains the issuer's Bitstring revocation list (status = revocation
 * only; freshness/re-issue is a follow-up, out of this round's scope).
 *
 * Identity and pod location are never accepted from request input:
 * @jeswr/solid-pod-guard's `createPodRouteGuard` DPoP-verifies the caller
 * (L1), derives the pod from the token WebID's bidirectional `pim:storage`
 * binding (L2), and rejects a `pod`/`webid` override at any depth in the
 * query or body (400) BEFORE any pod IO. Claims are the PINNED demo-persona
 * values (./flows.ts) — a request can only SELECT a flow, never a value, so
 * this route can never become a signing oracle. Every issued credential is
 * signed with `subject: caller.webid` (L3 — the holder-binding anchor).
 *
 * Pod IO runs over this app's OWN service identity (L4,
 * `createServicePodFetch`) — there is NO anonymous fallback. An unconfigured
 * flow (missing issuer key/WebID/status-list URL) or an unconfigured service
 * identity fails closed with 503 — never open.
 *
 * Known demo-scope limits (would need follow-up work before a multi-instance
 * production deploy): status-list index occupancy is tracked per-process
 * (`StatusIndexAllocator`); a hosted status list's `validUntil` is fixed at
 * creation and never durably extended on later writes; and re-issue
 * (freshness) is not implemented this round — an expired credential must be
 * revoked and re-issued as a fresh resource by an operator.
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
  flowEnvVar,
  ISSUER_FLOW_IDS,
  type IssuerFlowId,
  isIssuerFlowId,
  requiredConfig,
  type VerificationsIssuersConfig,
} from "./config";
import { capturedEncodingFor, ISSUER_FLOWS, type IssuerFlowDefinition } from "./flows";
import { createPodTurtle, podResourceExists, type PodIoFetch } from "./pod-io";
import { publicRequestUrl as defaultPublicRequestUrl } from "./url";

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Hosted-list lifetime a freshly-created list is signed for — generous
 * enough to outlive every flow's own `validUntilDays` (the longest is the
 * identity flow's 305 days) with margin. Fixed at creation time only (see the
 * module header's known-limits note).
 */
const STATUS_LIST_VALID_DAYS = 400;

function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * DAY_MS);
}

/**
 * The same fixed "rail not configured" fail-closed shape
 * @jeswr/solid-pod-guard's own `notConfigured` returns (that helper is not
 * re-exported from the package barrel, so it is mirrored here verbatim).
 */
function notConfigured(detail: string): Response {
  return Response.json(
    {
      detail: `${detail} — this rail fails closed until an operator configures it`,
      error: "not_configured",
      simulated: true,
    },
    { status: 503 },
  );
}

export interface IssuerServiceOptions {
  readonly guardConfig: PodGuardConfig;
  readonly issuers: VerificationsIssuersConfig;
  /** Owner-binding seams (profile fetch) for tests. */
  readonly ownerSeams?: OwnerBindingSeams;
  /** Public-URL reconstruction for the DPoP `htu` binding. Defaults to this app's basePath. */
  readonly publicRequestUrl?: (request: Request) => string;
  /** Injected in tests: writes to the caller's pod. Defaults to the L4 service identity. */
  readonly podFetch?: PodIoFetch;
  /**
   * Injected in tests: reads/writes the issuer's hosted status lists.
   * Default: the same service-identity fetch as the pod IO.
   */
  readonly statusHostFetch?: typeof fetch;
  /** Injected issuer signing keys (tests). Fall back to the env private JWKs. */
  readonly keys?: Partial<Record<IssuerFlowId, KeyPair>>;
  readonly now?: () => Date;
}

export interface IssuerService {
  /** POST `{ flow }` — scene 1: issue the flow's VC (+ anchor) into the pod. */
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

function badRequest(detail: string): Response {
  return Response.json({ detail, error: "malformed_request", simulated: true }, { status: 400 });
}

interface IssuedSummary {
  readonly id: string;
  readonly kind: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly statusListCredential: string;
  readonly statusListIndex: string | undefined;
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

interface Validity {
  readonly validFrom: Date;
  readonly validUntil: Date;
}

interface FlowRuntime {
  readonly definition: IssuerFlowDefinition;
  readonly issuerWebId: string;
  readonly key: KeyPair;
  readonly statusList: StatusListClient;
  readonly allocator: StatusIndexAllocator;
}

export function createIssuerService(options: IssuerServiceOptions): IssuerService {
  const { guardConfig, issuers } = options;

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
        clientId: requiredConfig(
          issuers.podServiceClientId,
          "LENDING_VERIFICATIONS_POD_SERVICE_CLIENT_ID",
        ),
        clientSecret: requiredConfig(
          issuers.podServiceClientSecret,
          "LENDING_VERIFICATIONS_POD_SERVICE_CLIENT_SECRET",
        ),
        issuer: requiredConfig(
          issuers.podServiceIssuer,
          "LENDING_VERIFICATIONS_POD_SERVICE_ISSUER",
        ),
      });
      return servicePodFetch;
    } catch (error) {
      return errorResponse(error);
    }
  }

  function getStatusHostFetch(): typeof fetch | Response {
    return options.statusHostFetch ?? getPodFetch();
  }

  const runtimes = new Map<IssuerFlowId, FlowRuntime>();
  async function runtimeFor(flow: IssuerFlowId): Promise<FlowRuntime | Response> {
    const cached = runtimes.get(flow);
    if (cached !== undefined) return cached;
    const statusHostFetch = getStatusHostFetch();
    if (statusHostFetch instanceof Response) return statusHostFetch;
    const identity = issuers.issuers[flow];
    try {
      const issuerWebId = requiredConfig(identity.webid, flowEnvVar(flow, "ISSUER_WEBID"));
      const statusListUrl = requiredConfig(
        identity.statusListUrl,
        flowEnvVar(flow, "STATUS_LIST_URL"),
      );
      let key = options.keys?.[flow];
      if (key === undefined) {
        const keyJwk = requiredConfig(identity.keyJwk, flowEnvVar(flow, "ISSUER_KEY_JWK"));
        const verificationMethod =
          identity.keyVerificationMethod ?? `${issuerWebId.split("#")[0]}#vc-key`;
        key = await importKeyPair(verificationMethod, JSON.parse(keyJwk));
      }
      const runtime: FlowRuntime = {
        allocator: new StatusIndexAllocator(),
        definition: ISSUER_FLOWS[flow],
        issuerWebId,
        key,
        statusList: new StatusListClient({
          fetch: statusHostFetch,
          issuer: issuerWebId,
          key,
          url: statusListUrl,
        }),
      };
      runtimes.set(flow, runtime);
      return runtime;
    } catch (error) {
      if (error instanceof Error && error.message.endsWith("is unset")) {
        return notConfigured(error.message);
      }
      // A malformed key JWK must not leak its contents into the response.
      return notConfigured(`${flowEnvVar(flow, "ISSUER_KEY_JWK")} could not be imported`);
    }
  }

  /** Create the hosted list on first use. Absent -> all-clear signed list; present -> no-op. */
  async function ensureStatusList(
    runtime: FlowRuntime,
    statusHostFetch: typeof fetch,
    now: Date,
  ): Promise<void> {
    const probe = await statusHostFetch(runtime.statusList.url, {
      headers: { accept: "application/vc+ld+json, application/json;q=0.9" },
    });
    if (probe.status === 404) {
      await runtime.statusList.create({ now, validUntil: daysFrom(now, STATUS_LIST_VALID_DAYS) });
      return;
    }
    if (!probe.ok) {
      throw new StatusListError(
        `status list probe GET ${runtime.statusList.url} failed: ${probe.status}`,
      );
    }
  }

  const guard: PodRouteGuard = createPodRouteGuard({
    config: guardConfig,
    ...(options.ownerSeams !== undefined ? { ownerSeams: options.ownerSeams } : {}),
    publicRequestUrl: options.publicRequestUrl ?? defaultPublicRequestUrl,
  });

  return {
    async issue(request) {
      return guard.handle(request, async (caller, body) => {
        const { flow } = body;
        if (typeof flow !== "string" || !isIssuerFlowId(flow)) {
          return badRequest(`body.flow must be one of: ${ISSUER_FLOW_IDS.join(", ")}`);
        }
        const podFetch = getPodFetch();
        if (podFetch instanceof Response) return podFetch;
        const statusHostFetch = getStatusHostFetch();
        if (statusHostFetch instanceof Response) return statusHostFetch;
        const runtime = await runtimeFor(flow);
        if (runtime instanceof Response) return runtime;
        const definition = runtime.definition;
        const now = options.now?.() ?? new Date();

        try {
          const credentialIri = `${caller.podBase}${definition.credentialPath.slice(1)}`;
          const anchorIri =
            definition.anchor === undefined
              ? undefined
              : `${caller.podBase}${definition.anchor.path.slice(1)}`;

          // Scene-1 issuance is a strict CREATE: either resource already
          // present ⇒ this flow was already issued — an operator/scripted
          // revoke-then-reissue is required to replace it (the freshness
          // re-issue rail is a follow-up, see the module header).
          const [existing, existingAnchor] = await Promise.all([
            podResourceExists(credentialIri, podFetch),
            anchorIri === undefined
              ? Promise.resolve(false)
              : podResourceExists(anchorIri, podFetch),
          ]);
          if (existing || existingAnchor) {
            return Response.json(
              {
                detail: "this flow's credential already exists in the vault",
                error: "already_issued",
                flow,
                simulated: true,
              },
              { status: 409 },
            );
          }

          await ensureStatusList(runtime, statusHostFetch, now);

          const validity: Validity = {
            validFrom: daysFrom(now, definition.validFromDays),
            validUntil: daysFrom(now, definition.validUntilDays),
          };
          const credentialIndex = runtime.allocator.allocate(credentialIri);
          const issued = await issueCredential({
            claims: definition.claims(caller.podBase),
            credentialId: credentialIri,
            issuer: runtime.issuerWebId,
            key: runtime.key,
            kind: definition.kind,
            status: runtime.statusList.entry(credentialIndex),
            subject: caller.webid,
            validity,
          });

          let anchorIssued: IssuedCredential | undefined;
          if (definition.anchor !== undefined && anchorIri !== undefined) {
            const operandEnc = capturedEncodingFor(definition);
            const anchorIndex = runtime.allocator.allocate(anchorIri);
            anchorIssued = await issueCredential({
              claims: { field: definition.anchor.field, kind: "zk-operand-anchor", operandEnc },
              credentialId: anchorIri,
              issuer: runtime.issuerWebId,
              key: runtime.key,
              kind: "zk-operand-anchor",
              status: runtime.statusList.entry(anchorIndex),
              subject: caller.webid,
              validity,
            });
          }

          // Pod mutations, anchor FIRST: a credential must never be reachable
          // in the pod without its operand anchor already beside it.
          if (anchorIssued !== undefined && anchorIri !== undefined) {
            await createPodTurtle(anchorIri, anchorIssued.body, podFetch);
          }
          await createPodTurtle(credentialIri, issued.body, podFetch);

          return Response.json({
            anchor:
              anchorIssued === undefined
                ? null
                : summarize(anchorIssued, runtime.statusList.url, validity),
            credential: summarize(issued, runtime.statusList.url, validity),
            flow,
            simulated: true,
          });
        } catch (error) {
          return errorResponse(error);
        }
      });
    },
  };
}
