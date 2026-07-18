/**
 * The lending seeder's pod-LAYOUT module: maps the scripted persona (`./credentials.ts`)
 * to a `@jeswr/solid-seed` `PodLayout` — the least-privilege access pattern from the
 * framework (`@jeswr/solid-seed`'s `AccessSpec`): owner-only on the private credentials
 * and ZK operand anchors, public-read on the issuer identity documents and status lists
 * (external verifiers must dereference those anonymously), and a public-read WebID
 * profile card.
 *
 * Every credential is ONE solid-seed expander group — one issuance call materialises the
 * VC and its operand anchor(s), so the outputs stay mutually consistent and a partially
 * seeded group is a loud error (solid-seed's `create`/`ensure`/`replace` semantics), never
 * a silent mix. The ISSUANCE itself is injected (`LendingCredentialIssuance`) — this
 * module only decides pod paths and access; `./issuance.ts` carries the vc-kit signing.
 */
import type {
  AccessSpec,
  PodLayout,
  ResourceExpander,
  ResourceSpec,
  SeedTarget,
} from "@jeswr/solid-seed";
import type { ScriptedCredentialSeed } from "./credentials.ts";
import type { LendingCredentialIssuance } from "./issuance.ts";
import { normalizedPodBase } from "./pod-base.ts";

/** Borrower-private: owner agent read/write/control only. */
export const LENDING_OWNER_ONLY_ACCESS: AccessSpec = { publicRead: false };

/** World-readable (plus full owner control): issuer identity documents, status lists and
 * the WebID profile card, which external verifiers must dereference anonymously. */
export const LENDING_PUBLIC_READ_ACCESS: AccessSpec = { publicRead: true };

function escapeTurtleLiteral(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/** The persona/profile document: a WebID profile card (`foaf:name` + `pim:storage` +
 * `schema:identifier`) — the demo persona's public-facing pod resource. */
function profileCardTurtle(options: {
  webid: string;
  name: string;
  identifier: string;
  storage: string;
}): string {
  return `@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix pim: <http://www.w3.org/ns/pim/space#> .
@prefix schema: <https://schema.org/> .

<${options.webid}>
    a foaf:Person ;
    foaf:name "${escapeTurtleLiteral(options.name)}" ;
    schema:identifier "${escapeTurtleLiteral(options.identifier)}" ;
    pim:storage <${options.storage}> .
`;
}

export interface LendingPodLayoutOptions {
  readonly displayName: string;
  readonly identifier: string;
  readonly credentials: readonly ScriptedCredentialSeed[];
  readonly issuance: LendingCredentialIssuance;
  /** Path of the WebID profile card. Defaults to `/profile/card`. */
  readonly profileCardPath?: string;
  /** Seed the WebID profile card. Default: only when the WebID lives on the pod origin
   * (an OIDC-mode identity lives at its dev issuer and cannot be seeded here). */
  readonly profileCard?: boolean;
}

function credentialExpander(
  spec: ScriptedCredentialSeed,
  issuance: LendingCredentialIssuance,
  podPath: (path: string) => string,
): ResourceExpander {
  return async (context): Promise<readonly ResourceSpec[]> => {
    const issued = await issuance.issue(spec, {
      webid: context.webid,
      resolve: (path) => context.resolve(podPath(path)),
    });
    if (spec.anchor !== undefined && issued.anchors.length === 0) {
      throw new Error(`issuance for ${spec.id} declared an anchor but minted none`);
    }
    return [
      {
        path: podPath(spec.path),
        source: { body: issued.vc.body },
        contentType: issued.vc.contentType,
        access: LENDING_OWNER_ONLY_ACCESS,
      },
      ...issued.anchors.map((anchor) => ({
        path: podPath(anchor.path),
        source: { body: anchor.body },
        contentType: anchor.contentType,
        access: LENDING_OWNER_ONLY_ACCESS,
      })),
    ];
  };
}

/**
 * Build the borrower-pod layout for one seed target: the WebID profile card, one expander
 * group per scripted credential (owner-only VC + owner-only anchors), and a final
 * expander for the issuer identity documents + status lists (public-read).
 */
export function lendingPodLayout(target: SeedTarget, options: LendingPodLayoutOptions): PodLayout {
  const podBase = normalizedPodBase(target.baseUrl);
  const baseUrl = new URL(podBase);
  const origin = baseUrl.origin;
  // solid-seed resolves resource paths against the pod ORIGIN (its `SeedTarget.baseUrl`
  // must be an origin), so pod-BASE-relative paths are prefixed with the base's pathname
  // here and solid-seed receives the origin-rooted target — the storage-root path is
  // never discarded.
  const pathPrefix = baseUrl.pathname === "/" ? "" : baseUrl.pathname.slice(0, -1);
  const podPath = (path: string): string => `${pathPrefix}${path}`;
  const webidUrl = new URL(target.webid);
  const resources: (ResourceSpec | ResourceExpander)[] = [];

  const wantsCard = options.profileCard ?? webidUrl.origin === origin;
  if (wantsCard) {
    if (webidUrl.origin !== origin) {
      throw new Error(
        `profileCard: WebID ${target.webid} is not on the pod origin ${origin} — its ` +
          "profile document cannot be seeded here",
      );
    }
    resources.push({
      path: options.profileCardPath ?? webidUrl.pathname,
      source: {
        body: profileCardTurtle({
          webid: target.webid,
          name: options.displayName,
          identifier: options.identifier,
          storage: podBase,
        }),
      },
      contentType: "text/turtle",
      access: LENDING_PUBLIC_READ_ACCESS,
    });
  }

  for (const spec of options.credentials) {
    resources.push(credentialExpander(spec, options.issuance, podPath));
  }

  resources.push(async (context): Promise<readonly ResourceSpec[]> => {
    const issuerResources = await options.issuance.issuerResources({
      webid: context.webid,
      resolve: (path) => context.resolve(podPath(path)),
    });
    if (issuerResources.length === 0) {
      throw new Error("issuance returned no issuer resources — verification would fail closed");
    }
    return issuerResources.map((resource) => ({
      path: podPath(resource.path),
      source: { body: resource.body },
      contentType: resource.contentType,
      access: LENDING_PUBLIC_READ_ACCESS,
    }));
  });

  return { pods: [{ account: { target: { ...target, baseUrl: origin } }, resources }] };
}
