#!/usr/bin/env node
/**
 * check-insignia.mjs — the never-render gate over YOUR domain's banned marks
 * (regulatory insignia, third-party product marks, certification badges).
 *
 * The framework ships NO built-in roster: `branding.bannedMarks` in
 * apps/tour/content/walkthrough.json is the single source. Each entry is
 * `{ "pattern": "\\bEXAMPLEMARK\\b", "reason": "why it must never render" }` —
 * a JS regex source, case-insensitive unless it contains an uppercase letter.
 * Until you add your roster this gate passes vacuously and says so.
 */
import { readFileSync } from "node:fs";
import { scanInsigniaTree } from "@jeswr/solid-showcase-kit/testing";

const DOCUMENT = "apps/tour/content/walkthrough.json";
// Insignia guard covers RENDERED / branded surfaces only (decision 0002) — the
// app trees, shared UI, seeds, and e2e. `docs/` is deliberately EXCLUDED: the
// use-case / design / research docs name the real-world stakeholders they model
// BY DESIGN, each under the "illustrative — not affiliated" concept-demo framing
// (naming a modelled-on org is disclosure, not impersonation). This matches the
// solid-mortgage insignia guard, which scans app/ui surfaces only.
const SCANNED = ["apps", "packages", "seeds", "e2e"];

const doc = JSON.parse(readFileSync(DOCUMENT, "utf8"));
const bannedMarks = doc.branding?.bannedMarks ?? [];

if (bannedMarks.length === 0) {
  process.stdout.write(
    "• check:insignia — no banned-marks roster configured yet. Add your domain's " +
      `never-render marks to branding.bannedMarks in ${DOCUMENT} (the framework ships none).\n`,
  );
  process.exit(0);
}

const findings = scanInsigniaTree(SCANNED, { bannedMarks, rootDir: process.cwd() });
if (findings.length > 0) {
  process.stderr.write(`✗ ${findings.length} insignia finding(s):\n`);
  for (const finding of findings) {
    process.stderr.write(`  ${finding.file}:${finding.line} [${finding.id}] ${finding.excerpt}\n`);
  }
  process.exit(1);
}
process.stdout.write(
  `✔ check:insignia — ${bannedMarks.length} banned mark(s), zero findings across ${SCANNED.join(", ")}\n`,
);
