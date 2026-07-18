/**
 * Shape gates: every committed shape parses, targeted resource shapes are
 * closed, the target-class table stays in lock-step with shapes/*.ttl, no
 * named node anywhere in the shapes leaves the allowed namespaces (the
 * no-minted-IRIs house rule), and every committed fixture behaves (valid
 * conforms, invalid does not).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Parser, Store } from "n3";
import { expect, test } from "vitest";
import {
  ALL_SHAPES_DOCUMENTS,
  PERSONA_SHAPE_IRI,
  personaShapePath,
  RESOURCE_TARGET_CLASSES,
  SHAPES_DOCUMENT_KEYS,
  shapesDir,
  validate,
} from "../src/index.ts";

const SH = "http://www.w3.org/ns/shacl#";

const ALLOWED_IRI_PREFIXES = [
  "http://www.w3.org/",
  "https://www.w3.org/",
  "https://schema.org/",
  "https://w3id.org/",
  "http://purl.org/dc/terms/",
  "https://spec.edmcouncil.org/fibo/ontology/",
  "urn:example:",
];

function allShapeQuads() {
  const store = new Store();
  for (const turtle of ALL_SHAPES_DOCUMENTS) {
    store.addQuads(new Parser({ format: "text/turtle" }).parse(turtle));
  }
  return store;
}

test("persona.ttl parses and declares the persona shape", () => {
  const quads = new Parser().parse(readFileSync(personaShapePath, "utf8"));
  expect(quads.length).toBeGreaterThan(0);
  expect(quads.some((quad) => quad.subject.value === PERSONA_SHAPE_IRI)).toBe(true);
});

test("the bundled shapes module matches shapes/*.ttl on disk", () => {
  const files = readdirSync(shapesDir)
    .filter((file) => file.endsWith(".ttl"))
    .map((file) => file.replace(/\.ttl$/, ""))
    .sort();
  expect([...SHAPES_DOCUMENT_KEYS].sort()).toEqual(files);
});

test("no minted IRIs: every named node in every shape uses an allowed namespace", () => {
  const named = new Set<string>();
  for (const quad of allShapeQuads()) {
    for (const term of [quad.subject, quad.predicate, quad.object]) {
      if (term.termType === "NamedNode") named.add(term.value);
    }
  }
  const violations = [...named].filter(
    (iri) => !ALLOWED_IRI_PREFIXES.some((prefix) => iri.startsWith(prefix)),
  );
  expect(violations).toEqual([]);
});

test("every RESOURCE_TARGET_CLASSES entry is a closed, targeted shape", () => {
  const shapes = allShapeQuads();
  for (const [kind, targetClass] of Object.entries(RESOURCE_TARGET_CLASSES)) {
    const shapeNodes = shapes.getSubjects(`${SH}targetClass`, targetClass, null);
    expect(shapeNodes.length, `${kind} must have exactly one targeted shape`).toBe(1);
    const shape = shapeNodes[0];
    if (shape === undefined) throw new Error("unreachable");
    const closed = shapes.getObjects(shape, `${SH}closed`, null).map((term) => term.value);
    expect(closed, `${kind} shape must be closed`).toEqual(["true"]);
  }
});

test("every targeted shape is accounted for in RESOURCE_TARGET_CLASSES (plus the persona card)", () => {
  const shapes = allShapeQuads();
  const targeted = new Set(
    shapes.getObjects(null, `${SH}targetClass`, null).map((term) => term.value),
  );
  const known = new Set<string>([
    ...Object.values(RESOURCE_TARGET_CLASSES),
    "https://schema.org/Person",
  ]);
  expect([...targeted].filter((iri) => !known.has(iri))).toEqual([]);
});

const FIXTURES_DIR = join(import.meta.dirname, "fixtures");

test("every committed fixture behaves as its name promises", async () => {
  const files = readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith(".ttl"))
    .sort();
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const turtle = readFileSync(join(FIXTURES_DIR, file), "utf8");
    const report = await validate(turtle);
    const expectConforms = file.endsWith(".valid.ttl");
    expect(
      report.conforms,
      `${file}: expected conforms=${expectConforms}${
        report.conforms ? "" : ` (${report.violations.map((v) => v.message).join(" | ")})`
      }`,
    ).toBe(expectConforms);
  }
});
