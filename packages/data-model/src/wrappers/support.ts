import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  RequiredAs,
  RequiredFrom,
  SetFrom,
  TermAs,
  TermWrapper,
} from "@rdfjs/wrapper";
import { RDF_TYPE, SCHEMA } from "../vocab/external.ts";
import { LEND } from "../vocab/lend.ts";
import { literalFromXsdDecimal } from "./mappings.ts";

/**
 * Typed accessors over the shared support nodes the resource shapes reference
 * via `sh:node` (shapes/common.ttl). All construction and mutation of these
 * nodes goes through these wrappers — never hand-built quads (house rule).
 *
 * Read discipline: pod RDF is untrusted input, so `validate()` the document
 * (with `expect` + `focusNode`) BEFORE wrapping it; the accessors then throw
 * descriptive errors on any residual malformation rather than guessing.
 */
export class TypedNode extends TermWrapper {
  /** `rdf:type` IRIs as a live, write-through set. */
  get typeIris(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }
}

/** `schema:PostalAddress` (lshape:PostalAddressShape — US-format fields). */
export class PostalAddress extends TypedNode {
  get streetAddress(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.streetAddress, LiteralAs.string);
  }
  set streetAddress(value: string) {
    RequiredAs.object(this, SCHEMA.streetAddress, value, LiteralFrom.string);
  }

  get addressLocality(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.addressLocality, LiteralAs.string);
  }
  set addressLocality(value: string) {
    RequiredAs.object(this, SCHEMA.addressLocality, value, LiteralFrom.string);
  }

  /** Two-letter US state code (shape-enforced pattern). */
  get addressRegion(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.addressRegion, LiteralAs.string);
  }
  set addressRegion(value: string) {
    RequiredAs.object(this, SCHEMA.addressRegion, value, LiteralFrom.string);
  }

  /** US ZIP or ZIP+4 (shape-enforced pattern). */
  get postalCode(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.postalCode, LiteralAs.string);
  }
  set postalCode(value: string) {
    RequiredAs.object(this, SCHEMA.postalCode, value, LiteralFrom.string);
  }
}

/** `schema:Organization` (lshape:OrganizationShape). */
export class OrganizationNode extends TypedNode {
  get organizationName(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.name, LiteralAs.string);
  }
  set organizationName(value: string) {
    RequiredAs.object(this, SCHEMA.name, value, LiteralFrom.string);
  }
}

/** `schema:MonetaryAmount` (lshape:MonetaryAmountShape — USD display money). */
export class MonetaryAmount extends TypedNode {
  /** `schema:value` as a number; written as a well-formed `xsd:decimal`. */
  get amountValue(): number {
    return RequiredFrom.subjectPredicate(this, SCHEMA.value, LiteralAs.number);
  }
  set amountValue(value: number) {
    if (value < 0) {
      throw new RangeError(`MonetaryAmount.amountValue must be >= 0, got ${value}`);
    }
    RequiredAs.object(this, SCHEMA.value, value, literalFromXsdDecimal);
  }

  get currency(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.currency, LiteralAs.string);
  }
  set currency(value: string) {
    RequiredAs.object(this, SCHEMA.currency, value, LiteralFrom.string);
  }
}

/** Masked `schema:DepositAccount` display node (lshape:DepositAccountShape). */
export class DepositAccount extends TypedNode {
  get provider(): OrganizationNode {
    return RequiredFrom.subjectPredicate(this, SCHEMA.provider, TermAs.instance(OrganizationNode));
  }

  /** Exactly four digits; the full account number never enters the pod. */
  get accountLast4(): string {
    return RequiredFrom.subjectPredicate(this, LEND.accountLast4, LiteralAs.string);
  }
  set accountLast4(value: string) {
    if (!/^[0-9]{4}$/.test(value)) {
      throw new RangeError(
        `accountLast4 must be exactly four digits, got ${JSON.stringify(value)}`,
      );
    }
    RequiredAs.object(this, LEND.accountLast4, value, LiteralFrom.string);
  }
}

/** One observed income stream (lshape:DepositStreamShape; FDX-shaped). */
export class DepositStream extends TypedNode {
  get streamName(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA.name, LiteralAs.string);
  }
  set streamName(value: string) {
    RequiredAs.object(this, SCHEMA.name, value, LiteralFrom.string);
  }

  /** Net monthly deposit attributed to this stream (display amount). */
  get monthlyAmount(): MonetaryAmount {
    return RequiredFrom.subjectPredicate(this, SCHEMA.amount, TermAs.instance(MonetaryAmount));
  }
}

/** The Reg Z payment schedule (lshape:RepaymentSpecificationShape). */
export class RepaymentSpecification extends TypedNode {
  get numberOfLoanPayments(): number {
    return RequiredFrom.subjectPredicate(this, SCHEMA.numberOfLoanPayments, LiteralAs.number);
  }
  set numberOfLoanPayments(value: number) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 360) {
      throw new RangeError(`numberOfLoanPayments must be an integer in 1..360, got ${value}`);
    }
    RequiredAs.object(this, SCHEMA.numberOfLoanPayments, value, LiteralFrom.integer);
  }

  get loanPaymentAmount(): MonetaryAmount {
    return RequiredFrom.subjectPredicate(
      this,
      SCHEMA.loanPaymentAmount,
      TermAs.instance(MonetaryAmount),
    );
  }

  /** Payments per year (12 = monthly) — the demo's pinned reading. */
  get loanPaymentFrequency(): number {
    return RequiredFrom.subjectPredicate(this, SCHEMA.loanPaymentFrequency, LiteralAs.number);
  }
  set loanPaymentFrequency(value: number) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 52) {
      throw new RangeError(`loanPaymentFrequency must be an integer in 1..52, got ${value}`);
    }
    RequiredAs.object(this, SCHEMA.loanPaymentFrequency, value, LiteralFrom.integer);
  }
}
