/**
 * The seeded DEV POD: boots one in-memory sparq dev-server account, seeds the full
 * scripted Maya Torres lending-persona layout (real signed VCs + ZK operand anchors, via
 * `@lending/seeds`) and prints the pod coordinates for the apps.
 *
 *   pnpm run dev:pod            # fresh seeded pod (strict create)
 *
 * Runs on Node >= 24 via native type stripping — imports carry explicit `.ts`
 * extensions. The pod is in-memory: stopping the process discards it, and every boot
 * reseeds deterministically from the same scripted-credential layer.
 */
import { createLendingIssuance, seedLendingPod } from "@lending/seeds";
import { startSolidServer } from "@lending/test-kit";

async function main(): Promise<void> {
  const server = await startSolidServer({});
  // The live server keeps the event loop alive: any post-startup failure must stop it,
  // or a failed dev:pod run hangs instead of exiting.
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

    console.log(`Seeded dev pod (persona ${seeded.persona.name})`);
    console.log(`  origin : ${new URL(seeded.baseUrl).origin}`);
    console.log(`  webid  : ${seeded.webid}`);
    for (const pod of seeded.manifest.pods) {
      for (const resource of pod.resources) {
        console.log(`  ${resource.status.padEnd(8)} ${resource.url}`);
      }
    }
    console.log("Ctrl-C to stop (pod is in-memory; every boot reseeds).");
  } catch (error) {
    try {
      await server.stop();
    } catch (stopError) {
      console.error(stopError);
    }
    throw error;
  }

  const stop = async () => {
    await server.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
