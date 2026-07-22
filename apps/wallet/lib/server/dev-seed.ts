/**
 * The wallet's dev-gated "Mode-1" seed: browser-triggered seeding of the real signed
 * Maya Torres lending-persona pod (sm-qz3j seeder round). This scaffold ships no
 * in-browser WASM pod runtime (unlike the solid-mortgage showcase's Mode-1 — see the PR
 * description for the gap), so this is the honest equivalent available today: a Next.js
 * Route Handler (Node runtime, server-side) that a client-side "Seed demo persona" button
 * calls — the seeding is BROWSER-TRIGGERED even though the vc-kit issuance itself runs
 * server-side (it needs `node:crypto`/`node:buffer`, never bundled to the client).
 *
 * Dev/demo only: fails closed like every other pod-facing surface in this repo (see
 * `../server/config.ts`'s pod-guard rail) — refuses outside development and refuses when
 * the seed target isn't configured, never picks a default pod to write into.
 */
import { createLendingIssuance, seedLendingPod, type SeededLendingPod } from "@lending/seeds";

const PREFIX = "LENDING";

export class DevSeedUnavailableError extends Error {}
export class DevSeedUnconfiguredError extends Error {}

/**
 * Whether this dev-only surface may run at all. Real deployments (Vercel
 * prod, or any operator who never sets the override below) always refuse —
 * `NODE_ENV !== "production"` is the default gate.
 *
 * `LENDING_WALLET_ALLOW_DEV_SURFACES=1` is a NARROW, explicit override for
 * exactly one situation: `next start` (a production BUILD, run for its own
 * reason — see `e2e/support/app-runner.ts`'s header, sm-qz3j.8) hardcodes
 * `NODE_ENV=production` in the server process regardless of what env the
 * parent passes it — Next.js does not allow un-forcing this. Since this
 * scaffold's ONLY way to exercise verify-on-view today is this dev-gated
 * route (see this module's header — no in-browser WASM pod runtime yet),
 * running the e2e journey against a production build would otherwise make
 * `/api/dev/credentials` permanently 404, independent of whether the
 * feature it stands in for actually works. The override changes nothing
 * about the fail-closed default: unset (every real deployment), this
 * function behaves EXACTLY as before.
 */
export function devSeedAllowed(): boolean {
  if (process.env.LENDING_WALLET_ALLOW_DEV_SURFACES === "1") return true;
  return process.env.NODE_ENV !== "production";
}

/** The configured seed target (`LENDING_SEED_POD_URL` / `LENDING_SEED_WEBID`), or
 * `undefined` when either is unset — never a fabricated default pod. */
export function devSeedTarget(): { podUrl: string; webid: string } | undefined {
  const podUrl = process.env[`${PREFIX}_SEED_POD_URL`];
  const webid = process.env[`${PREFIX}_SEED_WEBID`];
  if (podUrl === undefined || webid === undefined || podUrl === "" || webid === "") {
    return undefined;
  }
  return { podUrl, webid };
}

/**
 * Seed the demo persona pod named by env. `mode: "ensure"` converges without clobbering
 * (safe to click repeatedly), matching `pnpm run seed`'s target and semantics.
 */
export async function runDevSeed(): Promise<SeededLendingPod> {
  if (!devSeedAllowed()) {
    throw new DevSeedUnavailableError("the dev seed route is disabled in production");
  }
  const target = devSeedTarget();
  if (target === undefined) {
    throw new DevSeedUnconfiguredError(
      `set ${PREFIX}_SEED_POD_URL and ${PREFIX}_SEED_WEBID (see .env.example) — a dev seed ` +
        "target is never picked automatically",
    );
  }
  const now = new Date();
  const issuance = createLendingIssuance({ podOrigin: target.podUrl, now });
  return seedLendingPod({
    target: { webid: target.webid, baseUrl: target.podUrl, authFetch: fetch },
    issuance,
    now,
    mode: "ensure",
  });
}
