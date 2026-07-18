// Minimal ambient types for the published shacl-engine 1.1.x dist (the package
// ships no TypeScript types). Kept internal: nothing here surfaces in the
// package's emitted declarations.
declare module "shacl-engine" {
  import type { DatasetCore, NamedNode, Term } from "@rdfjs/types";

  interface ValidationResult {
    readonly constraintComponent?: NamedNode;
    readonly focusNode?: { term?: Term } | Term | null;
    readonly message: readonly { value: string }[];
    readonly path?: unknown;
    readonly severity?: NamedNode;
    readonly shape?: { ptr?: { term?: Term } };
    readonly value?: { term?: Term } | Term | null;
    readonly results: readonly ValidationResult[];
  }

  interface ValidationReport {
    readonly conforms: boolean;
    readonly results: readonly ValidationResult[];
  }

  interface ValidatorOptions {
    factory: unknown;
    coverage?: boolean;
    debug?: boolean;
    details?: boolean;
    trace?: boolean;
    validations?: Iterable<[unknown, unknown]>;
  }

  export class Validator {
    constructor(shapes: DatasetCore, options: ValidatorOptions);
    validate(data: { dataset: DatasetCore; terms?: Term[] }): Promise<ValidationReport>;
  }
}

declare module "shacl-engine/sparql.js" {
  export const validations: Iterable<[unknown, unknown]>;
  export const targetResolvers: Iterable<[unknown, unknown]>;
}

declare module "@rdfjs/data-model" {
  import type { DataFactory } from "@rdfjs/types";

  const factory: DataFactory;
  export default factory;
}

declare module "@rdfjs/dataset" {
  import type { DatasetCore, Quad } from "@rdfjs/types";

  const factory: { dataset(quads?: Iterable<Quad>): DatasetCore };
  export default factory;
}
