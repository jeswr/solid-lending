/**
 * Vocabulary gates: the generated constants stay in lock-step with
 * vocab/lend.ttl and the shapes (anchorable-field sh:in list, budget bounds),
 * and the generators' --check mode agrees the committed modules are fresh.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Parser, Store } from "n3";
import { expect, test } from "vitest";
import {
  LEND,
  LEND_NAMESPACE,
  SHAPES_TURTLE,
  ZK_ANCHORABLE_FIELD_IRIS,
  ZK_FIELD_BUDGETS,
} from "../src/index.ts";

const PACKAGE_ROOT = join(import.meta.dirname, "..");
const SH = "http://www.w3.org/ns/shacl#";
const RDF_FIRST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#first";
const RDF_REST = "http://www.w3.org/1999/02/22-rdf-syntax-ns#rest";
const RDF_NIL = "http://www.w3.org/1999/02/22-rdf-syntax-ns#nil";

test("every LEND constant is defined in vocab/lend.ttl", () => {
  const turtle = readFileSync(join(PACKAGE_ROOT, "vocab", "lend.ttl"), "utf8");
  const quads = new Parser({ format: "text/turtle" }).parse(turtle);
  const defined = new Set(
    quads
      .filter((quad) => quad.subject.value.startsWith(LEND_NAMESPACE))
      .map((quad) => quad.subject.value),
  );
  for (const iri of Object.values(LEND)) {
    expect(defined.has(iri), `${iri} must be defined in vocab/lend.ttl`).toBe(true);
  }
  expect(defined.size).toBe(Object.values(LEND).length);
});

test("generated modules are fresh (generator --check passes)", () => {
  for (const script of ["generate-vocab.mjs", "generate-shapes.mjs"]) {
    execFileSync(process.execPath, [join(PACKAGE_ROOT, "scripts", script), "--check"], {
      cwd: PACKAGE_ROOT,
    });
  }
});

function rdfList(store: Store, head: ReturnType<Store["getObjects"]>[number]): string[] {
  const items: string[] = [];
  let node = head;
  while (node.value !== RDF_NIL) {
    const first = store.getObjects(node, RDF_FIRST, null)[0];
    if (first === undefined) break;
    items.push(first.value);
    const rest = store.getObjects(node, RDF_REST, null)[0];
    if (rest === undefined) break;
    node = rest;
  }
  return items;
}

test("the anchor shape's sh:in list equals ZK_ANCHORABLE_FIELD_IRIS", () => {
  const store = new Store(
    new Parser({ format: "text/turtle" }).parse(SHAPES_TURTLE["zk-operand-anchor"]),
  );
  const fieldConstraints = store
    .getSubjects(`${SH}path`, LEND.field, null)
    .flatMap((subject) => store.getObjects(subject, `${SH}in`, null));
  expect(fieldConstraints).toHaveLength(1);
  const head = fieldConstraints[0];
  if (head === undefined) throw new Error("unreachable");
  expect(rdfList(store, head).sort()).toEqual([...ZK_ANCHORABLE_FIELD_IRIS].sort());
});

test("shape bounds mirror the ZK budgets (no drift)", () => {
  const shapes = new Store();
  for (const turtle of Object.values(SHAPES_TURTLE)) {
    shapes.addQuads(new Parser({ format: "text/turtle" }).parse(turtle));
  }
  for (const budget of ZK_FIELD_BUDGETS) {
    const constraints = shapes
      .getSubjects(`${SH}path`, budget.iri, null)
      .filter((subject) => shapes.getObjects(subject, `${SH}minInclusive`, null).length > 0);
    expect(constraints.length, `${budget.key} must have a bounded shape constraint`).toBe(1);
    const constraint = constraints[0];
    if (constraint === undefined) throw new Error("unreachable");
    const min = shapes.getObjects(constraint, `${SH}minInclusive`, null)[0]?.value;
    const max = shapes.getObjects(constraint, `${SH}maxInclusive`, null)[0]?.value;
    expect(Number(min), `${budget.key} minInclusive`).toBe(budget.minInclusive);
    expect(Number(max), `${budget.key} maxInclusive`).toBe(budget.maxInclusive);
  }
});

test("digit budgets bound their circuit operand width", () => {
  for (const budget of ZK_FIELD_BUDGETS) {
    expect(budget.maxInclusive).toBeLessThanOrEqual(10 ** budget.digits - 1);
    expect(budget.circuit).toBe(`filter_int_d${budget.digits}`);
  }
});
