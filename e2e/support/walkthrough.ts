/**
 * The SAME walkthrough registry every app's own `lib/walkthrough.ts` reads —
 * loaded via `fs.readFileSync` + `JSON.parse` (NOT a bare `.json` import:
 * Node's native ESM loader requires an import attribute for JSON that
 * Playwright's runner does not thread through, unlike Next.js's own bundled
 * dev server — sm-bvuh). Gives the journey each zone's registered slug (the
 * `ConsentInterstitial`'s `appId` / consent-cookie key) without hardcoding
 * six string literals in the spec.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseWalkthrough } from "@jeswr/solid-showcase";

const walkthroughPath = fileURLToPath(
  new URL("../../apps/tour/content/walkthrough.json", import.meta.url),
);
const walkthroughJson = JSON.parse(readFileSync(walkthroughPath, "utf8")) as unknown;

export const walkthrough = parseWalkthrough(walkthroughJson);

export type ZoneSlug =
  | "bank-lender"
  | "fintech-lender"
  | "bureau"
  | "disbursement"
  | "wallet"
  | "verifications";
