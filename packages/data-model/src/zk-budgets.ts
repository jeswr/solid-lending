import { LEND } from "./vocab/lend.ts";

/**
 * The per-field scaled-unit / digit-budget table for the three scene-2 ZK
 * predicates (design §4 rule 5): `net monthly income >= 2200`, `cash-flow
 * score >= 660`, `NSF events in 90 days = 0`. These are the ONLY ZK-provable
 * fields; every value is a plain xsd:integer in the stated unit, and the
 * SHACL shapes pin the identical bounds (test-enforced, no drift).
 *
 * The bounds give the sparq filter circuits their operand width statically:
 * seeded fixture values MUST respect them. All three circuit members exist
 * in the pinned sparq checkout's zk/compose workspace (filter_int_d2/d3/d4);
 * the Tier-A prover that consumes them is the NEXT build round
 * (docs/zk-plan.md).
 */
export interface ZkFieldBudget {
  /** Constant key in the LEND vocabulary map. */
  readonly key: "netMonthlyIncomeUsd" | "cashFlowScoreValue" | "nsf90Count";
  /** Full IRI of the field (lend namespace). */
  readonly iri: string;
  /** Scaled unit of the integer value. */
  readonly unit: "USD/month" | "score points" | "events";
  /** Digit budget (operand width of the matching filter circuit). */
  readonly digits: 2 | 3 | 4;
  /** Inclusive minimum, mirrored by sh:minInclusive in the shapes. */
  readonly minInclusive: number;
  /** Inclusive maximum, mirrored by sh:maxInclusive in the shapes. */
  readonly maxInclusive: number;
  /** sparq circuit that proves threshold statements over the field. */
  readonly circuit: "filter_int_d2" | "filter_int_d3" | "filter_int_d4";
}

export const ZK_FIELD_BUDGETS: readonly ZkFieldBudget[] = [
  {
    key: "netMonthlyIncomeUsd",
    iri: LEND.netMonthlyIncomeUsd,
    unit: "USD/month",
    digits: 4,
    minInclusive: 0,
    maxInclusive: 9999,
    circuit: "filter_int_d4",
  },
  {
    key: "cashFlowScoreValue",
    iri: LEND.cashFlowScoreValue,
    unit: "score points",
    digits: 3,
    minInclusive: 300,
    maxInclusive: 850,
    circuit: "filter_int_d3",
  },
  {
    // NSF90 = 0 is proved as an equality-to-zero threshold statement over a
    // 2-digit operand (design §6.5's digit-budget question, resolved:
    // filter_int_d2 is a member of the pinned sparq compose workspace).
    key: "nsf90Count",
    iri: LEND.nsf90Count,
    unit: "events",
    digits: 2,
    minInclusive: 0,
    maxInclusive: 99,
    circuit: "filter_int_d2",
  },
] as const;

/**
 * IRIs a lend:ZkOperandAnchor may anchor. Equals the sh:in list of
 * lshape:ZkOperandAnchorSubjectShape's lend:field constraint (test-enforced).
 */
export const ZK_ANCHORABLE_FIELD_IRIS: readonly string[] = ZK_FIELD_BUDGETS.map(
  (budget) => budget.iri,
);

/** Budget for a field IRI, or undefined when the field is not ZK-provable. */
export function zkBudgetFor(fieldIri: string): ZkFieldBudget | undefined {
  return ZK_FIELD_BUDGETS.find((budget) => budget.iri === fieldIri);
}

/**
 * True when the integer fits the field's digit budget — use for seed/fixture
 * data before it reaches a circuit.
 */
export function fitsZkBudget(fieldIri: string, value: number): boolean {
  const budget = zkBudgetFor(fieldIri);
  if (!budget || !Number.isSafeInteger(value)) return false;
  return value >= budget.minInclusive && value <= budget.maxInclusive;
}
