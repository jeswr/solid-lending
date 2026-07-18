import type { ITermFromValueMapping } from "@rdfjs/wrapper";
import { XSD } from "../vocab/external.ts";

/**
 * Custom `@rdfjs/wrapper` value-to-term mappings for the datatypes the
 * published `LiteralFrom` collection gets wrong or lacks.
 *
 * KNOWN GOTCHA (why `LiteralFrom.date` is banned here): `@rdfjs/wrapper`
 * 0.34.0's `LiteralFrom.date` emits `Date.toISOString()` - a dateTime lexical
 * form - typed `xsd:date`, which is malformed and fails every `sh:datatype
 * xsd:date` constraint in shapes/*.ttl. Use {@link literalFromXsdDate} for
 * `xsd:date` fields and the upstream `LiteralFrom.dateTime` for
 * `xsd:dateTime` fields; never `LiteralFrom.date`.
 */

/** A well-formed `xsd:date` literal from the Date's UTC calendar date. */
export const literalFromXsdDate: ITermFromValueMapping<Date> = (value, factory) => {
  if (Number.isNaN(value.getTime())) {
    throw new RangeError("literalFromXsdDate: invalid Date");
  }
  const year = String(value.getUTCFullYear()).padStart(4, "0");
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return factory.literal(`${year}-${month}-${day}`, factory.namedNode(XSD.date));
};

/**
 * A well-formed `xsd:decimal` literal. The lexical form always carries a
 * decimal point (`schema:value 340000` serialises as `"340000.0"`), and
 * non-finite or exponent-formatted numbers are rejected - `xsd:decimal` has
 * no lexical space for them.
 */
export const literalFromXsdDecimal: ITermFromValueMapping<number> = (value, factory) => {
  if (!Number.isFinite(value)) {
    throw new RangeError(`literalFromXsdDecimal: ${value} is not a finite number`);
  }
  const lexical = Number.isInteger(value) ? `${value}.0` : String(value);
  if (lexical.includes("e") || lexical.includes("E")) {
    throw new RangeError(
      `literalFromXsdDecimal: ${value} stringifies to exponent notation, outside xsd:decimal's lexical space`,
    );
  }
  return factory.literal(lexical, factory.namedNode(XSD.decimal));
};
