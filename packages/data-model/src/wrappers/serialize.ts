import { serialize } from "@jeswr/rdf-serialize";
import type { Quad } from "@rdfjs/types";
import { type ShaclReport, validate } from "../shacl.ts";
import { TURTLE_PREFIXES } from "../vocab/external.ts";
import type { LendingResource } from "./resources.ts";

/** Thrown by {@link resourceToTurtle} when the document breaks its shape. */
export class ShapeViolationError extends Error {
  /** The resource kind whose shape was violated. */
  readonly kind: string;
  /** The full SHACL report (violations flattened to plain strings). */
  readonly report: ShaclReport;

  // No TS parameter properties here: this package ships SOURCE and must stay
  // runnable under Node's strip-only type erasure (seeds/run.ts precedent).
  constructor(kind: string, report: ShaclReport) {
    const detail = report.violations
      .map((violation) => `- ${violation.message} (path ${violation.path.join(" / ")})`)
      .join("\n");
    super(`${kind} document violates its SHACL shape:\n${detail}`);
    this.name = "ShapeViolationError";
    this.kind = kind;
    this.report = report;
  }
}

/**
 * The single write path out of the wrapper layer: validate the document
 * against its resource shape (root-bound, so a decoy node cannot satisfy the
 * target), then serialise to Turtle via the sanctioned `n3.Writer` wrapper.
 * Throws {@link ShapeViolationError} instead of ever emitting non-conforming
 * bytes — every setter path is therefore shape-checked on serialize.
 */
export async function resourceToTurtle(resource: LendingResource): Promise<string> {
  const report = await validate(resource.dataset, {
    expect: resource.resourceKind,
    focusNode: resource.termType === "NamedNode" ? resource.value : undefined,
  });
  if (!report.conforms) {
    throw new ShapeViolationError(resource.resourceKind, report);
  }
  return serialize([...resource.dataset] as Quad[], { prefixes: TURTLE_PREFIXES });
}
