/**
 * The Reg B adverse-action notice (scene 3, decline branch) — the Personal
 * Loan Desk's signature demo artifact: bureau-only decisioning is bureau-only
 * BY DESIGN (the demo's inclusion-thesis contrast), so a decline here still
 * owes the borrower the SAME specific-principal-reasons notice ECOA/Reg B
 * requires (12 CFR §1002.9) regardless of what a cash-flow-underwriting
 * lender elsewhere in the walkthrough would have decided on the same
 * evidence.
 *
 * No SHACL shape for this resource kind exists in `@lending/data-model` (it
 * is this app's OWN resource, outside that package's §6.2 credential
 * registry — data-model is a shared, consumed package, not one this app
 * modifies). It is still composed through the SAME house RDF discipline
 * data-model's own builders use: typed `@rdfjs/wrapper` accessors over a
 * fresh `n3.Store` (never hand-built quads, never string-concatenated
 * Turtle), serialised through the suite's single sanctioned
 * `@jeswr/rdf-serialize` `n3.Writer` wrapper. Every predicate is a REAL,
 * dereferenceable schema.org / Dublin Core term — `schema:RejectAction` is a
 * real schema.org action subtype (Action > AllocateAction > RejectAction);
 * `dcterms:created` is re-exported by `@lending/data-model`; the handful of
 * `schema:` terms data-model does not itself re-export (`agent`, `object`,
 * `about`, `provider`, `description`) are bound locally below, under the
 * SAME real `https://schema.org/` namespace data-model's own vocab module
 * uses — no minted IRIs.
 */
import { DCTERMS, RDF_TYPE } from "@lending/data-model";
import { serialize } from "@jeswr/rdf-serialize";
import type { Quad } from "@rdfjs/types";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  RequiredAs,
  RequiredFrom,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";

const SCHEMA_NS = "https://schema.org/";

/** schema.org terms this module needs beyond `@lending/data-model`'s own re-exported subset (real, dereferenceable — https://schema.org/<name>). */
const SCHEMA_EXT = {
  RejectAction: `${SCHEMA_NS}RejectAction`,
  about: `${SCHEMA_NS}about`,
  agent: `${SCHEMA_NS}agent`,
  description: `${SCHEMA_NS}description`,
  object: `${SCHEMA_NS}object`,
  provider: `${SCHEMA_NS}provider`,
} as const;

/** Turtle prefixes for the notice document. */
const PREFIXES: Readonly<Record<string, string>> = {
  dcterms: "http://purl.org/dc/terms/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  schema: SCHEMA_NS,
};

/** Reg B §1002.9's timing anchor (12 CFR §1002.9) — the design's scene-3 compliance citation. */
export const REG_B_ADVERSE_ACTION_TIMING =
  "Adverse-action notice with specific principal reasons, consistent with Regulation B's requirement that reasons be stated clearly and specifically (12 CFR §1002.9).";

/** The statutory-rights boilerplate every Reg B/FCRA adverse-action notice carries. */
export const REG_B_STATUTORY_NOTICE =
  "Under the Equal Credit Opportunity Act and Regulation B (12 CFR §1002.9), you have the right to a statement of the specific reasons for this action. You also have the right to obtain, within 60 days, a free copy of the credit report the bureau furnished, and to dispute its accuracy or completeness directly with that bureau (Fair Credit Reporting Act, 15 U.S.C. §1681).";

/**
 * Typed accessor over the notice's `schema:RejectAction` root node. Read AND
 * build go through this wrapper — app code never walks the dataset or
 * concatenates Turtle (house rule, carried over from `@lending/data-model`'s
 * own wrapper discipline).
 */
export class AdverseActionNotice extends TermWrapper {
  /** `rdf:type` IRIs as a live, write-through set. */
  get typeIris(): Set<string> {
    return SetFrom.subjectPredicate(this, RDF_TYPE, NamedNodeAs.string, NamedNodeFrom.string);
  }

  /** `schema:agent` — this lender's own identity (the decision-maker). */
  get agentWebId(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA_EXT.agent, NamedNodeAs.string);
  }
  set agentWebId(value: string) {
    RequiredAs.object(this, SCHEMA_EXT.agent, value, NamedNodeFrom.string);
  }

  /** `schema:about` — the borrower this notice concerns. */
  get aboutWebId(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA_EXT.about, NamedNodeAs.string);
  }
  set aboutWebId(value: string) {
    RequiredAs.object(this, SCHEMA_EXT.about, value, NamedNodeFrom.string);
  }

  /** `schema:object` — the pod IRI of the credit-score credential this decision relied on. */
  get reliedOnCredentialIri(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA_EXT.object, NamedNodeAs.string);
  }
  set reliedOnCredentialIri(value: string) {
    RequiredAs.object(this, SCHEMA_EXT.object, value, NamedNodeFrom.string);
  }

  /** `schema:provider` — the credit bureau that furnished the report relied upon (FCRA §604 disclosure). */
  get reportProviderWebId(): string {
    return RequiredFrom.subjectPredicate(this, SCHEMA_EXT.provider, NamedNodeAs.string);
  }
  set reportProviderWebId(value: string) {
    RequiredAs.object(this, SCHEMA_EXT.provider, value, NamedNodeFrom.string);
  }

  /** `dcterms:created` — when the decision was made. */
  get createdAt(): Date {
    return RequiredFrom.subjectPredicate(this, DCTERMS.created, LiteralAs.date);
  }
  set createdAt(value: Date) {
    RequiredAs.object(this, DCTERMS.created, value, LiteralFrom.dateTime);
  }

  /** `schema:description` — the specific principal reasons plus the statutory-rights text (unbounded; live write-through set). */
  get descriptions(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      SCHEMA_EXT.description,
      LiteralAs.string,
      LiteralFrom.string,
    );
  }
}

export interface AdverseActionNoticeInit {
  /** The notice's own pod resource IRI. */
  readonly iri: string;
  /** This lender's own identity IRI. */
  readonly issuerWebId: string;
  /** The borrower WebID (subject of the decision). */
  readonly borrowerWebId: string;
  /** The pod IRI of the credit-score credential this decision relied on. */
  readonly reliedOnCredentialIri: string;
  /** The credit bureau's issuer identity (FCRA §604 "report furnished by" disclosure). */
  readonly reportProviderWebId: string;
  readonly decidedAt: Date;
  /** Reg B specific principal reasons (design's canon: "insufficient credit history", "limited tradelines"). */
  readonly principalReasons: readonly string[];
}

/** Build the notice through the typed wrapper — never a hand-built quad. */
export function buildAdverseActionNotice(init: AdverseActionNoticeInit): AdverseActionNotice {
  const store = new Store();
  const root = DataFactory.namedNode(init.iri);
  const notice = new AdverseActionNotice(root, store, DataFactory);
  notice.typeIris.add(SCHEMA_EXT.RejectAction);
  notice.agentWebId = init.issuerWebId;
  notice.aboutWebId = init.borrowerWebId;
  notice.reliedOnCredentialIri = init.reliedOnCredentialIri;
  notice.reportProviderWebId = init.reportProviderWebId;
  notice.createdAt = init.decidedAt;
  const descriptions = notice.descriptions;
  for (const reason of init.principalReasons) descriptions.add(`Principal reason: ${reason}`);
  descriptions.add(REG_B_STATUTORY_NOTICE);
  return notice;
}

/** Serialise the notice to Turtle via the suite's single sanctioned n3.Writer wrapper. */
export function adverseActionNoticeToTurtle(notice: AdverseActionNotice): Promise<string> {
  return serialize([...notice.dataset] as Quad[], { prefixes: PREFIXES });
}
