#!/usr/bin/env node
/**
 * Gate step (pnpm run check:shapes, wired into the root gate): validates every
 * SHACL shapes document and every fixture without needing a package build.
 *
 * - shapes/*.ttl must parse and every targeted resource shape must be closed;
 * - every test/fixtures/<name>.valid.ttl must conform;
 * - every test/fixtures/<name>.invalid.ttl must NOT conform.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import dataFactory from "@rdfjs/data-model";
import datasetFactory from "@rdfjs/dataset";
import { Parser, Store } from "n3";
import { Validator } from "shacl-engine";
import { validations as sparqlValidations } from "shacl-engine/sparql.js";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const SHAPES_DIR = path.join(PACKAGE_ROOT, "shapes");
const FIXTURES_DIR = path.join(PACKAGE_ROOT, "test", "fixtures");
const SH = "http://www.w3.org/ns/shacl#";

const factory = {
  ...dataFactory,
  namedNode: dataFactory.namedNode.bind(dataFactory),
  blankNode: dataFactory.blankNode.bind(dataFactory),
  literal: dataFactory.literal.bind(dataFactory),
  variable: dataFactory.variable.bind(dataFactory),
  defaultGraph: dataFactory.defaultGraph.bind(dataFactory),
  quad: dataFactory.quad.bind(dataFactory),
  dataset: datasetFactory.dataset.bind(datasetFactory),
};

function parseTurtle(turtle, source) {
  try {
    return new Parser({ format: "text/turtle" }).parse(turtle);
  } catch (error) {
    throw new Error(`${source} does not parse: ${error.message}`);
  }
}

const failures = [];

const shapes = new Store();
const shapeFiles = (await readdir(SHAPES_DIR)).filter((file) => file.endsWith(".ttl")).sort();
for (const file of shapeFiles) {
  shapes.addQuads(parseTurtle(await readFile(path.join(SHAPES_DIR, file), "utf8"), file));
}

const targeted = shapes.getSubjects(`${SH}targetClass`, null, null);
for (const shape of targeted) {
  const closed = shapes.getObjects(shape, `${SH}closed`, null).map((term) => term.value);
  if (closed.join() !== "true") failures.push(`${shape.value} is not sh:closed`);
}

const validator = new Validator(shapes, { factory, validations: sparqlValidations });

const fixtureFiles = (await readdir(FIXTURES_DIR)).filter((file) => file.endsWith(".ttl")).sort();
let checked = 0;
for (const file of fixtureFiles) {
  const dataset = new Store(
    parseTurtle(await readFile(path.join(FIXTURES_DIR, file), "utf8"), file),
  );
  const report = await validator.validate({ dataset });
  const expectConforms = file.endsWith(".valid.ttl");
  if (report.conforms !== expectConforms) {
    const detail = report.results
      .map((result) => result.message.map((message) => message.value).join("; "))
      .join(" | ");
    failures.push(
      `${file}: expected conforms=${expectConforms}, got ${report.conforms}${detail ? ` (${detail})` : ""}`,
    );
  }
  checked += 1;
}

console.log(
  `check:shapes - ${shapeFiles.length} shape documents, ${targeted.length} targeted resource shapes, ${checked} fixtures`,
);
if (failures.length > 0) {
  console.error(`\nShape check failures:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("All shapes closed; all fixtures behave as expected.");
