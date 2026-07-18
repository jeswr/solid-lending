/**
 * Playwright GLOBAL SETUP: one pre-seeded borrower pod per e2e run. Boots a sparq
 * dev-server account, seeds the full Maya Torres lending-persona layout (real signed VCs
 * + ZK operand anchors — strict `create` mode, a doubly seeded pod is a harness bug) and
 * exports the pod's coordinates to the suites via environment variables:
 *
 * - `LENDING_E2E_POD_ORIGIN` — the seeded pod's origin;
 * - `LENDING_E2E_POD_WEBID`  — the borrower WebID;
 * - `LENDING_E2E_SEEDED_AT`  — the seed instant (ISO), so suites can reason about the
 *   backdated employment window without re-reading the clock.
 *
 * The server lives in the runner process for the whole run; the returned teardown stops
 * it. Suites that need write isolation keep booting their own per-suite pods — this pod
 * is the ONE pre-seeded borrower vault (single writer; other suites must not touch it).
 */
import { createLendingIssuance, seedLendingPod } from "@lending/seeds";
import { startSolidServer } from "@lending/test-kit";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const server = await startSolidServer({});
  try {
    const account = server.accounts[0];
    if (account === undefined) throw new Error("solid server booted with no primary account");
    const now = new Date();
    const issuance = createLendingIssuance({ podOrigin: account.baseUrl, now });
    const seeded = await seedLendingPod({
      target: { webid: account.webid, baseUrl: account.baseUrl, authFetch: account.authFetch },
      issuance,
      now,
      mode: "create",
    });
    process.env.LENDING_E2E_POD_ORIGIN = new URL(seeded.baseUrl).origin;
    process.env.LENDING_E2E_POD_WEBID = seeded.webid;
    process.env.LENDING_E2E_SEEDED_AT = now.toISOString();
  } catch (error) {
    await server.stop();
    throw error;
  }
  return async () => {
    await server.stop();
  };
}
