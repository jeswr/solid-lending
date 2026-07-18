#!/usr/bin/env node
/**
 * Generates src/vocab/lend.ts (committed) from vocab/lend.ttl, the single
 * source of truth for the lending residue vocabulary.
 *
 *   node scripts/generate-vocab.mjs          # (re)write the constants module
 *   node scripts/generate-vocab.mjs --check  # exit 1 if the committed module drifted
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Parser } from "n3";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const VOCAB_TTL = path.join(PACKAGE_ROOT, "vocab", "lend.ttl");
const OUTPUT = path.join(PACKAGE_ROOT, "src", "vocab", "lend.ts");
const LEND_NAMESPACE = "urn:example:lend#";
const LEND_ONTOLOGY_IRI = "urn:example:lend";

function termLocalNames(quads) {
  const locals = new Set();
  for (const quad of quads) {
    if (quad.subject.termType === "NamedNode" && quad.subject.value.startsWith(LEND_NAMESPACE)) {
      locals.add(quad.subject.value.slice(LEND_NAMESPACE.length));
    }
  }
  return [...locals].sort((a, b) => a.localeCompare(b));
}

function constantKey(localName) {
  const key = localName.replaceAll("-", "_");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`term local name is not codegen-safe: ${localName}`);
  }
  return key;
}

export async function generateModule() {
  const turtle = await readFile(VOCAB_TTL, "utf8");
  const quads = new Parser({ format: "text/turtle" }).parse(turtle);
  const locals = termLocalNames(quads);
  if (locals.length === 0) throw new Error(`no lend: terms found in ${VOCAB_TTL}`);

  const entries = locals
    .map((local) => {
      // Match Biome's formatter (lineWidth 100): break long entries after the key.
      const oneLine = `  ${constantKey(local)}: "${LEND_NAMESPACE}${local}",`;
      return oneLine.length <= 100
        ? oneLine
        : `  ${constantKey(local)}:\n    "${LEND_NAMESPACE}${local}",`;
    })
    .join("\n");
  return `// Generated from vocab/lend.ttl by scripts/generate-vocab.mjs - DO NOT EDIT.
// Regenerate from packages/data-model: node scripts/generate-vocab.mjs

/** Identity of the lend residue vocabulary (RFC 6963 example URN - local, non-dereferenceable). */
export const LEND_ONTOLOGY_IRI = "${LEND_ONTOLOGY_IRI}";

/** Namespace of the lend residue vocabulary. */
export const LEND_NAMESPACE = "${LEND_NAMESPACE}";

/**
 * IRI constants for every term defined in vocab/lend.ttl
 * (hyphens in SKOS concept local names become underscores).
 */
export const LEND = {
${entries}
} as const;

/** Constant keys of the lend vocabulary. */
export type LendTermKey = keyof typeof LEND;

/** Term IRIs of the lend vocabulary. */
export type LendTermIri = (typeof LEND)[LendTermKey];
`;
}

const isCheck = process.argv.includes("--check");
const generated = await generateModule();
if (isCheck) {
  const committed = await readFile(OUTPUT, "utf8").catch(() => "");
  if (committed !== generated) {
    console.error(
      `${path.relative(PACKAGE_ROOT, OUTPUT)} is stale - run: node scripts/generate-vocab.mjs`,
    );
    process.exit(1);
  }
  console.log("vocab constants are up to date");
} else {
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, generated);
  console.log(`wrote ${path.relative(PACKAGE_ROOT, OUTPUT)}`);
}
