/**
 * The scene-5 repayment authorization: an ODRL policy document (real W3C ODRL
 * 2.2 vocabulary, `http://www.w3.org/ns/odrl/2/` — already dereference-checked
 * by `lint:iris` via `@lending/data-model`'s own `odrl:target` use) the
 * borrower grants to the winning cash-flow lender, carrying the 12 CFR 1041
 * subpart C payment-provision rail as an inspectable ODRL constraint rather
 * than prose: `odrl:count <= 2` on the debit-attempt permission — "no third
 * payment-withdrawal attempt after two consecutive failures without fresh
 * authorization" (design §6.4 `payday-payment-provisions`).
 *
 * This is NOT a `@lending/data-model` "lending resource" (no SHACL shape
 * ships for it — the credential/VC layer does not know about ODRL policy
 * documents), so it is built the SAME way the mortgage showcase's WAC ACL
 * documents are: through `@rdfjs/wrapper` typed accessors directly, into a
 * fresh `n3.Store`, serialised with the house-sanctioned `@jeswr/rdf-serialize`
 * (never hand-built triples, never string-concatenated Turtle — house rule).
 *
 * Every grant/revoke transition over this resource ALSO writes the ordinary
 * `dpv:ConsentReceipt` (`../grants/engine.ts`) whose `odrl:target` names this
 * same document — the receipt is the auditable "who/when", this document is
 * the auditable "under what terms".
 */
import { ODRL, RDF_TYPE, TURTLE_PREFIXES } from "@lending/data-model";
import { serialize } from "@jeswr/rdf-serialize";
import type { Quad, Term } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  RequiredAs,
  RequiredFrom,
  TermAs,
  TermFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";

/** ODRL 2.2 terms this document uses beyond `odrl:target` (already bound by data-model). */
const ODRL_NS = "http://www.w3.org/ns/odrl/2/";
const ODRL_EXTRA = {
  Agreement: `${ODRL_NS}Agreement`,
  Permission: `${ODRL_NS}Permission`,
  Constraint: `${ODRL_NS}Constraint`,
  permission: `${ODRL_NS}permission`,
  assigner: `${ODRL_NS}assigner`,
  assignee: `${ODRL_NS}assignee`,
  action: `${ODRL_NS}action`,
  use: `${ODRL_NS}use`,
  constraint: `${ODRL_NS}constraint`,
  leftOperand: `${ODRL_NS}leftOperand`,
  operator: `${ODRL_NS}operator`,
  rightOperand: `${ODRL_NS}rightOperand`,
  count: `${ODRL_NS}count`,
  lteq: `${ODRL_NS}lteq`,
} as const;

/** Real, dereferenceable Dublin Core term this document uses beyond what
 * `@lending/data-model`'s `DCTERMS` binds (`created`/`issued` only). */
const DCTERMS_DESCRIPTION = "http://purl.org/dc/terms/description";

/** A plain typed-RDF node — this document is not a `@lending/data-model` shape,
 * so it has no `TypedNode` base to extend; the same `@rdfjs/wrapper` primitives
 * apply directly (house rule: RDF only through typed accessors). */
class TypedTerm extends TermWrapper {}

/** `odrl:Constraint` — one comparison over a countable right (this document: attempt count). */
export class RepaymentConstraint extends TypedTerm {
  get leftOperandIri(): string {
    return RequiredFrom.subjectPredicate(this, ODRL_EXTRA.leftOperand, NamedNodeAs.string);
  }
  set leftOperandIri(value: string) {
    RequiredAs.object(this, ODRL_EXTRA.leftOperand, value, NamedNodeFrom.string);
  }

  get operatorIri(): string {
    return RequiredFrom.subjectPredicate(this, ODRL_EXTRA.operator, NamedNodeAs.string);
  }
  set operatorIri(value: string) {
    RequiredAs.object(this, ODRL_EXTRA.operator, value, NamedNodeFrom.string);
  }

  get rightOperandValue(): number {
    return RequiredFrom.subjectPredicate(this, ODRL_EXTRA.rightOperand, LiteralAs.number);
  }
  set rightOperandValue(value: number) {
    RequiredAs.object(this, ODRL_EXTRA.rightOperand, value, LiteralFrom.integer);
  }
}

/** `odrl:Permission` — the debit action, its target, and its constraint. */
export class RepaymentPermission extends TypedTerm {
  get actionIri(): string {
    return RequiredFrom.subjectPredicate(this, ODRL_EXTRA.action, NamedNodeAs.string);
  }
  set actionIri(value: string) {
    RequiredAs.object(this, ODRL_EXTRA.action, value, NamedNodeFrom.string);
  }

  get targetIri(): string {
    return RequiredFrom.subjectPredicate(this, ODRL.target, NamedNodeAs.string);
  }
  set targetIri(value: string) {
    RequiredAs.object(this, ODRL.target, value, NamedNodeFrom.string);
  }

  get constraint(): RepaymentConstraint {
    return RequiredFrom.subjectPredicate(
      this,
      ODRL_EXTRA.constraint,
      TermAs.instance(RepaymentConstraint),
    );
  }
}

/** `odrl:Agreement` — the repayment-authorization policy root. */
export class RepaymentAuthorization extends TypedTerm {
  get assignerIri(): string {
    return RequiredFrom.subjectPredicate(this, ODRL_EXTRA.assigner, NamedNodeAs.string);
  }
  set assignerIri(value: string) {
    RequiredAs.object(this, ODRL_EXTRA.assigner, value, NamedNodeFrom.string);
  }

  get assigneeIri(): string {
    return RequiredFrom.subjectPredicate(this, ODRL_EXTRA.assignee, NamedNodeAs.string);
  }
  set assigneeIri(value: string) {
    RequiredAs.object(this, ODRL_EXTRA.assignee, value, NamedNodeFrom.string);
  }

  get description(): string {
    return RequiredFrom.subjectPredicate(this, DCTERMS_DESCRIPTION, LiteralAs.string);
  }

  get permission(): RepaymentPermission {
    return RequiredFrom.subjectPredicate(
      this,
      ODRL_EXTRA.permission,
      TermAs.instance(RepaymentPermission),
    );
  }
}

export interface RepaymentAuthorizationInit {
  /** The document's own resource IRI (this app's `REPAYMENT_AUTHORIZATION_PATH`). */
  readonly iri: string;
  /** The borrower WebID. */
  readonly assigner: string;
  /** The lender's service WebID (the party this policy authorizes). */
  readonly assignee: string;
  /** The pod resource the debit authorization concerns (the loan-offer document). */
  readonly targetIri: string;
  /** 12 CFR 1041 subpart C: attempts after two consecutive failures require new authorization. */
  readonly maxFailedAttempts: number;
}

function link(parent: Term, dataset: Store, predicate: string, node: Term): void {
  RequiredAs.object(new TypedTerm(parent, dataset, DataFactory), predicate, node, TermFrom.itself);
}

/**
 * Build the repayment-authorization ODRL document. Deterministic fragment
 * IRIs (not blank nodes) for the permission/constraint child nodes — this
 * document is fully owned by the wallet, so stable addressability beats blank
 * node anonymity and lets the constraint be referenced directly if a future
 * scene needs to.
 */
export function buildRepaymentAuthorization(init: RepaymentAuthorizationInit): {
  readonly resource: RepaymentAuthorization;
  readonly dataset: Store;
} {
  const dataset = new Store();
  const root = DataFactory.namedNode(init.iri);
  const permissionNode = DataFactory.namedNode(`${init.iri}#permission`);
  const constraintNode = DataFactory.namedNode(`${init.iri}#constraint`);

  const resource = new RepaymentAuthorization(root, dataset, DataFactory);
  RequiredAs.object(resource, RDF_TYPE, ODRL_EXTRA.Agreement, NamedNodeFrom.string);
  resource.assignerIri = init.assigner;
  resource.assigneeIri = init.assignee;
  RequiredAs.object(
    resource,
    DCTERMS_DESCRIPTION,
    `12 CFR 1041 subpart C: no third payment-withdrawal attempt after two consecutive ` +
      `failures without fresh authorization; advance notice of the first attempt is given ` +
      `out of band (design §6.4 payday-payment-provisions).`,
    LiteralFrom.string,
  );
  link(root, dataset, ODRL_EXTRA.permission, permissionNode);

  const permission = new RepaymentPermission(permissionNode, dataset, DataFactory);
  RequiredAs.object(permission, RDF_TYPE, ODRL_EXTRA.Permission, NamedNodeFrom.string);
  permission.actionIri = ODRL_EXTRA.use;
  permission.targetIri = init.targetIri;
  link(permissionNode, dataset, ODRL_EXTRA.constraint, constraintNode);

  const constraint = new RepaymentConstraint(constraintNode, dataset, DataFactory);
  RequiredAs.object(constraint, RDF_TYPE, ODRL_EXTRA.Constraint, NamedNodeFrom.string);
  constraint.leftOperandIri = ODRL_EXTRA.count;
  constraint.operatorIri = ODRL_EXTRA.lteq;
  constraint.rightOperandValue = init.maxFailedAttempts;

  return { resource, dataset };
}

export async function repaymentAuthorizationToTurtle(dataset: Store): Promise<string> {
  return serialize([...dataset] as Quad[], {
    prefixes: { ...TURTLE_PREFIXES, dcterms: "http://purl.org/dc/terms/" },
  });
}
