/// <reference path="./types/shacl-engine.d.ts" />
import dataFactory from "@rdfjs/data-model";
import datasetFactory from "@rdfjs/dataset";
import type { DatasetCore, Term } from "@rdfjs/types";
import { Parser, Store } from "n3";
import { Validator } from "shacl-engine";
import { validations as sparqlValidations } from "shacl-engine/sparql.js";
import { ALL_SHAPES_DOCUMENTS } from "./shapes/shapes.ts";
import { DPV } from "./vocab/external.ts";
import { LEND } from "./vocab/lend.ts";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/**
 * sh:targetClass of each resource shape, keyed by its shapes document. Kept
 * in lock-step with shapes/*.ttl by a test. Used by validate()'s `expect`
 * option: SHACL validation is target-driven, so a document containing NO node
 * of the expected class would otherwise conform vacuously — dangerous for
 * untrusted pod RDF.
 */
export const RESOURCE_TARGET_CLASSES = {
  "identity-credential": LEND.IdentityCredential,
  "employment-income-credential": LEND.EmploymentIncomeCredential,
  "bank-cashflow-credential": LEND.BankCashFlowCredential,
  "cashflow-score-credential": LEND.CashFlowScoreCredential,
  "credit-score-credential": LEND.CreditScoreCredential,
  "loan-offer-credential": LEND.LoanOfferCredential,
  "disbursement-receipt-credential": LEND.DisbursementReceiptCredential,
  "repayment-history-credential": LEND.RepaymentHistoryCredential,
  "consent-receipt": DPV.ConsentReceipt,
  "zk-operand-anchor": LEND.ZkOperandAnchor,
} as const;

/** The lending resource kinds validate() can be told to expect. */
export type LendingResourceKind = keyof typeof RESOURCE_TARGET_CLASSES;

/** One SHACL validation result, flattened to plain strings for callers. */
export interface ShaclViolation {
  /** Human-readable message (sh:message where the shape provides one). */
  readonly message: string;
  /** IRI or blank-node label of the failing focus node. */
  readonly focusNode?: string;
  /** Predicate IRIs of the failing property path, in step order. */
  readonly path: readonly string[];
  /** The offending value, when the constraint reports one. */
  readonly value?: string;
  /** IRI of the SHACL constraint component that failed. */
  readonly constraintComponent?: string;
}

/** Result of validating a dataset against the bundled lending shapes. */
export interface ShaclReport {
  readonly conforms: boolean;
  readonly violations: readonly ShaclViolation[];
}

export interface ValidateOptions {
  /**
   * Base IRI used when `data` is a Turtle string — pass the pod resource URL
   * so relative IRIs resolve the way the server sees them.
   */
  readonly baseIRI?: string;
  /**
   * The resource kind this document is supposed to contain. When set, a
   * document with no node typed as that kind's target class FAILS instead of
   * conforming vacuously. ALWAYS set this when validating untrusted pod RDF,
   * and pass `focusNode` too whenever the root IRI is known.
   */
  readonly expect?: LendingResourceKind;
  /**
   * IRI of the node that must BE the expected resource. Without it, `expect`
   * only proves that SOME node has the target type — a decoy node of the
   * right type beside an untyped root would still pass. Requires `expect`.
   */
  readonly focusNode?: string;
}

/**
 * shacl-engine needs a combined RDF/JS data factory + dataset factory (its
 * validation report is built with `factory.dataset()`).
 */
const engineFactory = {
  ...dataFactory,
  namedNode: dataFactory.namedNode.bind(dataFactory),
  blankNode: dataFactory.blankNode.bind(dataFactory),
  literal: dataFactory.literal.bind(dataFactory),
  variable: dataFactory.variable?.bind(dataFactory),
  defaultGraph: dataFactory.defaultGraph.bind(dataFactory),
  quad: dataFactory.quad.bind(dataFactory),
  dataset: datasetFactory.dataset.bind(datasetFactory),
};

let cachedValidator: Validator | undefined;

function shapesValidator(): Validator {
  if (!cachedValidator) {
    const shapes = new Store();
    for (const turtle of ALL_SHAPES_DOCUMENTS) {
      shapes.addQuads(new Parser({ format: "text/turtle" }).parse(turtle));
    }
    // details: nested sh:node results are reported, so a violation inside a
    // support shape (e.g. a bad postalCode) surfaces itself rather than an
    // opaque NodeConstraintComponent at the referencing property.
    // sparql validations power the arithmetic/sum constraints (sh:sparql).
    cachedValidator = new Validator(shapes, {
      factory: engineFactory,
      details: true,
      validations: sparqlValidations,
    });
  }
  return cachedValidator;
}

function termValue(candidate: unknown): string | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const direct = candidate as Term;
  if (typeof direct.termType === "string" && typeof direct.value === "string") {
    return direct.value;
  }
  const wrapped = (candidate as { term?: Term }).term;
  return wrapped && typeof wrapped.value === "string" ? wrapped.value : undefined;
}

function pathPredicates(path: unknown): readonly string[] {
  if (!Array.isArray(path)) return [];
  const predicates: string[] = [];
  for (const step of path) {
    const stepPredicates = (step as { predicates?: readonly Term[] }).predicates;
    if (!Array.isArray(stepPredicates)) continue;
    for (const predicate of stepPredicates) {
      const value = termValue(predicate);
      if (value !== undefined) predicates.push(value);
    }
  }
  return predicates;
}

/**
 * Validate pod data against the bundled lending SHACL shapes (the eight §6.2
 * credential shapes, the consent receipt, the ZK operand anchor and the
 * persona card).
 *
 * Every resource an app writes MUST conform before the write; treat pod RDF
 * as untrusted input and validate on read where the data crosses a trust
 * boundary. Accepts any RDF/JS DatasetCore (e.g. the dataset behind a
 * `@jeswr/fetch-rdf` result) or a Turtle string.
 */
export async function validate(
  data: DatasetCore | string,
  options: ValidateOptions = {},
): Promise<ShaclReport> {
  const dataset: DatasetCore =
    typeof data === "string"
      ? new Store(new Parser({ format: "text/turtle", baseIRI: options.baseIRI }).parse(data))
      : data;

  if (options.focusNode !== undefined && options.expect === undefined) {
    throw new RangeError("validate(): focusNode requires expect");
  }

  if (options.expect !== undefined) {
    const targetClass = RESOURCE_TARGET_CLASSES[options.expect];
    // Binding to the intended root closes the decoy bypass: once the root is
    // required to carry the target type, SHACL targeting validates it.
    const typed = dataset.match(
      options.focusNode === undefined ? null : dataFactory.namedNode(options.focusNode),
      dataFactory.namedNode(RDF_TYPE),
      dataFactory.namedNode(targetClass),
    );
    if (typed.size === 0) {
      const where =
        options.focusNode === undefined
          ? "expected at least one node"
          : `expected <${options.focusNode}> to be`;
      return {
        conforms: false,
        violations: [
          {
            message: `no ${options.expect} resource found: ${where} typed <${targetClass}> (SHACL targeting would conform vacuously)`,
            focusNode: options.focusNode,
            path: [RDF_TYPE],
          },
        ],
      };
    }
  }

  const report = await shapesValidator().validate({ dataset });

  return {
    conforms: report.conforms,
    violations: flattenResults(report.results).map((result) => ({
      message:
        result.message.map((literal) => literal.value).join("; ") ||
        (termValue(result.constraintComponent) ?? "constraint violated"),
      focusNode: termValue(result.focusNode),
      path: pathPredicates(result.path),
      value: termValue(result.value),
      constraintComponent: termValue(result.constraintComponent),
    })),
  };
}

type EngineResult = Awaited<ReturnType<Validator["validate"]>>["results"][number];

/**
 * Flatten nested results depth-first. Parents stay in the list: a qualified
 * or sh:node violation is reported by its parent result, while its children
 * explain which inner constraint each value missed.
 */
function flattenResults(results: readonly EngineResult[]): readonly EngineResult[] {
  return results.flatMap((result) => [result, ...flattenResults(result.results)]);
}
