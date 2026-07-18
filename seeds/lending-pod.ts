/**
 * Seed one borrower pod with the full scripted Maya Torres persona layout through
 * `@jeswr/solid-seed`. This is the ONE seeding path all three consumption points share:
 *
 * - dev server: `scripts/dev-pod.ts` boots a harness account and calls this with
 *   `mode: "create"` (fresh in-memory pod per boot);
 * - e2e global-setup: `e2e/support/global-setup.ts` does the same once per Playwright run
 *   and exports the pod coordinates to the suites;
 * - the wallet's dev-gated Mode-1 seed route (`apps/wallet/app/api/dev/seed/route.ts`)
 *   calls this against the pod named by `LENDING_SEED_POD_URL`/`LENDING_SEED_WEBID`, the
 *   same target `pnpm run seed` writes to, with `mode: "ensure"`.
 */
import { type SeedManifest, type SeedTarget, seedPods } from "@jeswr/solid-seed";
import type { PersonaValues } from "@lending/data-model";
import { mayaTorres, type ScriptedCredentialSeed, scriptedCredentialSeeds } from "./credentials.ts";
import type { LendingCredentialIssuance } from "./issuance.ts";
import { type LendingPodLayoutOptions, lendingPodLayout } from "./layout.ts";
import { normalizedPodBase } from "./pod-base.ts";

export interface SeedLendingPodOptions {
  /** The live pod (harness account or any Fetch-compatible target). */
  readonly target: SeedTarget;
  readonly issuance: LendingCredentialIssuance;
  /** The demo reference instant — REQUIRED, never ambient. */
  readonly now: Date;
  /**
   * Write mode (solid-seed semantics): `create` strict-creates (e2e default — a doubly
   * seeded pod is a harness bug), `ensure` converges a long-lived dev pod, `replace`
   * deterministically rewrites.
   */
  readonly mode?: "create" | "ensure" | "replace";
  readonly profileCard?: LendingPodLayoutOptions["profileCard"];
}

export interface SeededLendingPod {
  readonly manifest: SeedManifest;
  readonly persona: PersonaValues;
  readonly credentials: readonly ScriptedCredentialSeed[];
  readonly webid: string;
  readonly baseUrl: string;
}

/** Resolve a pod-root-relative path to its absolute resource IRI on `podBase` — the SAME
 * computation `lendingPodLayout`'s expanders perform via solid-seed's `context.resolve`,
 * needed here up front so cross-resource claims (the cash-flow score credential's
 * `prov:wasDerivedFrom`) can be built before any resource actually exists. */
function resolverFor(podBase: string): (path: string) => string {
  const originAndPrefix = podBase.slice(0, -1); // strip the trailing slash normalizedPodBase adds
  return (path: string) => `${originAndPrefix}${path}`;
}

/** The scripted credential seeds for Maya Torres (the sm-qz3j seeder's one persona). */
export function lendingCredentialSeeds(
  target: SeedTarget,
  now: Date,
): readonly ScriptedCredentialSeed[] {
  const resolve = resolverFor(normalizedPodBase(target.baseUrl));
  return scriptedCredentialSeeds(mayaTorres(), now, resolve);
}

/** Seed the full Maya Torres lending-persona pod layout onto `options.target`. */
export async function seedLendingPod(options: SeedLendingPodOptions): Promise<SeededLendingPod> {
  const persona = mayaTorres();
  const credentials = lendingCredentialSeeds(options.target, options.now);
  const layout = lendingPodLayout(options.target, {
    displayName: persona.name,
    identifier: persona.identifier,
    credentials,
    issuance: options.issuance,
    ...(options.profileCard === undefined ? {} : { profileCard: options.profileCard }),
  });
  const manifest = await seedPods({ layout, mode: options.mode ?? "create" });
  return {
    manifest,
    persona,
    credentials,
    webid: options.target.webid,
    baseUrl: options.target.baseUrl,
  };
}
