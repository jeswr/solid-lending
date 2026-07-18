#!/usr/bin/env node
/**
 * Generates src/shapes/shapes.ts (committed) from shapes/*.ttl, the single
 * source of truth for the SHACL shapes, so validate() works without filesystem
 * access (browser included).
 *
 *   node scripts/generate-shapes.mjs          # (re)write the shapes module
 *   node scripts/generate-shapes.mjs --check  # exit 1 if the committed module drifted
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Parser } from "n3";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const SHAPES_DIR = path.join(PACKAGE_ROOT, "shapes");
const OUTPUT = path.join(PACKAGE_ROOT, "src", "shapes", "shapes.ts");

function escapeTemplateLiteral(text) {
  return text.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${");
}

/** Match Biome: quote object keys only when they are not valid identifiers. */
function objectKey(stem) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(stem) ? stem : `"${stem}"`;
}

export async function generateModule() {
  const files = (await readdir(SHAPES_DIR)).filter((file) => file.endsWith(".ttl")).sort();
  if (files.length === 0) throw new Error(`no .ttl shape documents found in ${SHAPES_DIR}`);

  const entries = [];
  for (const file of files) {
    const turtle = await readFile(path.join(SHAPES_DIR, file), "utf8");
    // Fail codegen on unparseable Turtle rather than shipping a broken module.
    new Parser({ format: "text/turtle" }).parse(turtle);
    entries.push(
      `  ${objectKey(file.replace(/\.ttl$/, ""))}: \`${escapeTemplateLiteral(turtle)}\`,`,
    );
  }

  return `// Generated from shapes/*.ttl by scripts/generate-shapes.mjs - DO NOT EDIT.
// Regenerate from packages/data-model: node scripts/generate-shapes.mjs

/**
 * Turtle source of every SHACL shapes document, keyed by its file stem in
 * shapes/ ("common" holds the shared support shapes the resource shapes
 * reference via sh:node).
 */
export const SHAPES_TURTLE = {
${entries.join("\n")}
} as const;

/** Document keys of the bundled SHACL shapes. */
export type ShapesDocumentKey = keyof typeof SHAPES_TURTLE;

/** Every bundled shapes document, in one Turtle-parseable list. */
export const ALL_SHAPES_DOCUMENTS: readonly string[] = Object.values(SHAPES_TURTLE);

/** File stem of the ${files.length} bundled shapes documents. */
export const SHAPES_DOCUMENT_KEYS = Object.keys(SHAPES_TURTLE) as readonly ShapesDocumentKey[];
`;
}

const isCheck = process.argv.includes("--check");
const generated = await generateModule();
if (isCheck) {
  const committed = await readFile(OUTPUT, "utf8").catch(() => "");
  if (committed !== generated) {
    console.error(
      `${path.relative(PACKAGE_ROOT, OUTPUT)} is stale - run: node scripts/generate-shapes.mjs`,
    );
    process.exit(1);
  }
  console.log("shape constants are up to date");
} else {
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, generated);
  console.log(`wrote ${path.relative(PACKAGE_ROOT, OUTPUT)}`);
}
