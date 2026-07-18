// Generated from shapes/*.ttl by scripts/generate-shapes.mjs - DO NOT EDIT.
// Regenerate from packages/data-model: node scripts/generate-shapes.mjs

/**
 * Turtle source of every SHACL shapes document, keyed by its file stem in
 * shapes/ ("common" holds the shared support shapes the resource shapes
 * reference via sh:node).
 */
export const SHAPES_TURTLE = {
  "bank-cashflow-credential": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix sec: <https://w3id.org/security#> .
@prefix schema: <https://schema.org/> .
@prefix lend: <urn:example:lend#> .
@prefix lshape: <urn:example:lend-shape#> .

# §6.2 row 3: the FDX-shaped bank cash-flow VC issued by the bank-data-provider
# seat (scene 1) from a consumer-permissioned connection. Attribute set:
# deposit streams, NSF-in-90-days, balance statistics - field mapping to FDX
# API semantics in docs/fibo-fdx-binding.md (documentation-level; FDX ships no
# RDF namespace).
lshape:BankCashFlowCredentialShape
  a sh:NodeShape ;
  sh:targetClass lend:BankCashFlowCredential ;
  sh:closed true ;
  sh:ignoredProperties ( sec:proof ) ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue cred:VerifiableCredential ;
  ] ;
  sh:property [
    sh:path cred:issuer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path cred:validFrom ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
    sh:lessThan cred:validUntil ;
  ] ;
  sh:property [
    sh:path cred:validUntil ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path cred:credentialStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
  ] ;
  sh:property [
    sh:path cred:credentialSubject ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:node lshape:BankCashFlowSubjectShape ;
    sh:message "credentialSubject must be the borrower WebID (holder binding)" ;
  ] ;
  sh:property [
    sh:path cred:credentialSchema ;
    sh:nodeKind sh:IRI ;
  ] .

# The cash-flow attribute set. Streams and balances are DISCLOSED display
# facts (they feed the scene-3 cash-flow underwrite under a scoped grant);
# nsf90Count is additionally the scene-2 ZK equality-to-zero operand.
lshape:BankCashFlowSubjectShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:ignoredProperties ( rdf:type ) ;
  sh:property [
    sh:path schema:owns ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:DepositAccountShape ;
  ] ;
  sh:property [
    sh:path lend:hasDepositStream ;
    sh:minCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:DepositStreamShape ;
  ] ;
  sh:property [
    # ZK field: 2-digit budget, sparq filter_int_d2 (scene-2 predicate:
    # NSF90 = 0, proved as an equality-to-zero threshold statement).
    sh:path lend:nsf90Count ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:integer ;
    sh:minInclusive 0 ;
    sh:maxInclusive 99 ;
    sh:message "nsf90Count must fit the 2-digit ZK budget (0..99 events)" ;
  ] ;
  sh:property [
    sh:path lend:hasAverageDailyBalance ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:MonetaryAmountShape ;
  ] ;
  sh:property [
    sh:path lend:observationMonths ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:integer ;
    sh:minInclusive 1 ;
    sh:maxInclusive 36 ;
  ] .
`,
  "cashflow-score-credential": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix sec: <https://w3id.org/security#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix lend: <urn:example:lend#> .
@prefix lshape: <urn:example:lend-shape#> .

# §6.2 row 4: the cash-flow score VC (scene 1). Derived from the bank
# cash-flow VC: the credential node carries prov:wasDerivedFrom pointing at
# the cash-flow credential's pod resource - the FCRA permissible-purpose
# story renders that provenance edge.
lshape:CashFlowScoreCredentialShape
  a sh:NodeShape ;
  sh:targetClass lend:CashFlowScoreCredential ;
  sh:closed true ;
  sh:ignoredProperties ( sec:proof ) ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue cred:VerifiableCredential ;
  ] ;
  sh:property [
    sh:path cred:issuer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path cred:validFrom ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
    sh:lessThan cred:validUntil ;
  ] ;
  sh:property [
    sh:path cred:validUntil ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path cred:credentialStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
  ] ;
  sh:property [
    sh:path cred:credentialSubject ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:node lshape:CashFlowScoreSubjectShape ;
    sh:message "credentialSubject must be the borrower WebID (holder binding)" ;
  ] ;
  sh:property [
    # The bank cash-flow credential this score was computed from (required -
    # the derived-from link is the row's defining feature).
    sh:path prov:wasDerivedFrom ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:message "a cash-flow score must name the cash-flow credential it derives from" ;
  ] ;
  sh:property [
    sh:path cred:credentialSchema ;
    sh:nodeKind sh:IRI ;
  ] .

# The score claims. No disclosed derivative of the hidden operand beyond the
# score itself (which IS the operand - hidden at pre-qual, granted later).
lshape:CashFlowScoreSubjectShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:ignoredProperties ( rdf:type ) ;
  sh:property [
    # ZK field: 3-digit budget, sparq filter_int_d3 (scene-2 predicate:
    # score >= 660). Range pinned to 300..850 so the demo scale reads
    # familiarly (illustrative, unbranded model).
    sh:path lend:cashFlowScoreValue ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:integer ;
    sh:minInclusive 300 ;
    sh:maxInclusive 850 ;
    sh:message "cashFlowScoreValue must fit the 3-digit ZK budget (300..850)" ;
  ] ;
  sh:property [
    sh:path lend:scoreModel ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:in ( lend:ScoreModel-CashFlowV1 ) ;
  ] .
`,
  common: `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix schema: <https://schema.org/> .
@prefix lend: <urn:example:lend#> .
@prefix lshape: <urn:example:lend-shape#> .

# Shared support shapes referenced (sh:node) by the resource shapes. None
# declares a target: they validate only where a resource shape points at them.
# Shape identities live in the RFC 6963 example URN space (house rule: no
# minted http IRIs; a hosted shapes namespace can supersede this in one
# commit once published).

lshape:PostalAddressShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue schema:PostalAddress ;
  ] ;
  sh:property [
    sh:path schema:streetAddress ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:minLength 1 ;
  ] ;
  sh:property [
    sh:path schema:addressLocality ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:minLength 1 ;
  ] ;
  sh:property [
    sh:path schema:addressRegion ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:pattern "^[A-Z]{2}$" ;
    sh:message "addressRegion must be a two-letter US state code" ;
  ] ;
  sh:property [
    sh:path schema:postalCode ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:pattern "^[0-9]{5}(-[0-9]{4})?$" ;
    sh:message "postalCode must be a US ZIP or ZIP+4" ;
  ] .

lshape:OrganizationShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:property [
    # Extra types (e.g. schema:BankOrCreditUnion on a provider node) are
    # permitted: only the presence of schema:Organization is required.
    sh:path rdf:type ;
    sh:hasValue schema:Organization ;
  ] ;
  sh:property [
    sh:path schema:name ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:minLength 1 ;
  ] .

lshape:MonetaryAmountShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue schema:MonetaryAmount ;
  ] ;
  sh:property [
    sh:path schema:value ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:decimal ;
    sh:minInclusive 0.0 ;
  ] ;
  sh:property [
    sh:path schema:currency ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:in ( "USD" ) ;
  ] .

# Masked deposit-account display node (the full account number never enters
# the pod; balances are carried as attributes on the cash-flow subject, not
# here).
lshape:DepositAccountShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue schema:DepositAccount ;
  ] ;
  sh:property [
    sh:path schema:provider ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:OrganizationShape ;
  ] ;
  sh:property [
    sh:path lend:accountLast4 ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:pattern "^[0-9]{4}$" ;
    sh:message "accountLast4 must be exactly four digits (masked display identifier)" ;
  ] .

# One observed recurring income stream (FDX-shaped; docs/fibo-fdx-binding.md).
lshape:DepositStreamShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue lend:DepositStream ;
  ] ;
  sh:property [
    sh:path schema:name ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:minLength 1 ;
  ] ;
  sh:property [
    # Net monthly deposit attributed to this stream (display amount).
    sh:path schema:amount ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:MonetaryAmountShape ;
  ] .

# The Reg Z payment schedule as schema.org's RepaymentSpecification (the
# schema.org financial-extension vocabulary contributed from FIBO work).
lshape:RepaymentSpecificationShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue schema:RepaymentSpecification ;
  ] ;
  sh:property [
    sh:path schema:numberOfLoanPayments ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:integer ;
    sh:minInclusive 1 ;
    sh:maxInclusive 360 ;
  ] ;
  sh:property [
    sh:path schema:loanPaymentAmount ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:MonetaryAmountShape ;
  ] ;
  sh:property [
    # Payments per year (12 = monthly) - the demo's fixed reading of
    # schema:loanPaymentFrequency, pinned in docs/fibo-fdx-binding.md.
    sh:path schema:loanPaymentFrequency ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:integer ;
    sh:minInclusive 1 ;
    sh:maxInclusive 52 ;
  ] .
`,
  "consent-receipt": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix dpv: <https://w3id.org/dpv#> .
@prefix odrl: <http://www.w3.org/ns/odrl/2/> .
@prefix lshape: <urn:example:lend-shape#> .

# APP-LEVEL receipt (the mortgage demo's consent-ledger pattern carried
# over): WAC enforces the access change; neither WAC nor the Solid protocol
# is represented as an audit provider. Scene 5's revocation ledger renders
# these receipts.
lshape:ConsentReceiptShape
  a sh:NodeShape ;
  sh:targetClass dpv:ConsentReceipt ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue dpv:ConsentReceipt ;
  ] ;
  sh:property [
    sh:path dpv:hasDataSubject ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path dpv:hasDataController ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path odrl:target ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path dpv:hasConsentStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:in ( dpv:ConsentGiven dpv:ConsentWithdrawn ) ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path dcterms:issued ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] .
`,
  "credit-score-credential": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix sec: <https://w3id.org/security#> .
@prefix lend: <urn:example:lend#> .
@prefix lshape: <urn:example:lend-shape#> .

# §6.2 row 5: the traditional bureau-score VC issued by the bureau seat - the
# "old rail" of the scene-3 two-models contrast. Disclosed display values;
# not ZK-participating in this demo. The thin-file facts (tradeline count,
# history months) are what the bureau-only model declines on.
lshape:CreditScoreCredentialShape
  a sh:NodeShape ;
  sh:targetClass lend:CreditScoreCredential ;
  sh:closed true ;
  sh:ignoredProperties ( sec:proof ) ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue cred:VerifiableCredential ;
  ] ;
  sh:property [
    sh:path cred:issuer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path cred:validFrom ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
    sh:lessThan cred:validUntil ;
  ] ;
  sh:property [
    sh:path cred:validUntil ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path cred:credentialStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
  ] ;
  sh:property [
    sh:path cred:credentialSubject ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:node lshape:CreditScoreSubjectShape ;
    sh:message "credentialSubject must be the borrower WebID (holder binding)" ;
  ] ;
  sh:property [
    sh:path cred:credentialSchema ;
    sh:nodeKind sh:IRI ;
  ] .

lshape:CreditScoreSubjectShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:ignoredProperties ( rdf:type ) ;
  sh:property [
    sh:path lend:creditScoreValue ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:integer ;
    sh:minInclusive 300 ;
    sh:maxInclusive 850 ;
    sh:message "creditScoreValue must be in the 300..850 bureau range" ;
  ] ;
  sh:property [
    sh:path lend:tradelineCount ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:integer ;
    sh:minInclusive 0 ;
    sh:maxInclusive 99 ;
  ] ;
  sh:property [
    sh:path lend:creditHistoryMonths ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:integer ;
    sh:minInclusive 0 ;
    sh:maxInclusive 999 ;
  ] ;
  sh:property [
    sh:path lend:scoreModel ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:in ( lend:ScoreModel-BureauClassic ) ;
  ] .
`,
  "disbursement-receipt-credential": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix sec: <https://w3id.org/security#> .
@prefix schema: <https://schema.org/> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix lend: <urn:example:lend#> .
@prefix lshape: <urn:example:lend-shape#> .

# §6.2 row 7: the push-to-card funding receipt (scene 4). start/settle
# timestamps carry the minutes-not-days beat; a receipt records a fact, so
# validUntil is optional (revocation via the status list still applies if a
# receipt is ever issued in error).
lshape:DisbursementReceiptCredentialShape
  a sh:NodeShape ;
  sh:targetClass lend:DisbursementReceiptCredential ;
  sh:closed true ;
  sh:ignoredProperties ( sec:proof ) ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue cred:VerifiableCredential ;
  ] ;
  sh:property [
    sh:path cred:issuer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path cred:validFrom ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path cred:validUntil ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path cred:credentialStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
  ] ;
  sh:property [
    sh:path cred:credentialSubject ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:node lshape:DisbursementReceiptSubjectShape ;
    sh:message "credentialSubject must be the borrower WebID (holder binding)" ;
  ] ;
  sh:property [
    # The accepted loan offer this disbursement funds.
    sh:path prov:wasDerivedFrom ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path cred:credentialSchema ;
    sh:nodeKind sh:IRI ;
  ] .

lshape:DisbursementReceiptSubjectShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:ignoredProperties ( rdf:type ) ;
  sh:property [
    sh:path lend:hasDisbursement ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:MoneyTransferShape ;
  ] .

# The funding event as a schema:MoneyTransfer. startTime/endTime are the
# initiated/settled instants; sh:lessThan pins settlement strictly after
# initiation.
lshape:MoneyTransferShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue schema:MoneyTransfer ;
  ] ;
  sh:property [
    sh:path schema:amount ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:MonetaryAmountShape ;
  ] ;
  sh:property [
    sh:path schema:startTime ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
    sh:lessThan schema:endTime ;
    sh:message "a settled transfer must end after it starts" ;
  ] ;
  sh:property [
    sh:path schema:endTime ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path lend:paymentRail ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:in ( lend:PaymentRail-PushToCard ) ;
  ] ;
  sh:property [
    # Destination card, masked - the full PAN never enters the pod.
    sh:path lend:accountLast4 ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:pattern "^[0-9]{4}$" ;
    sh:message "accountLast4 must be exactly four digits (masked display identifier)" ;
  ] .
`,
  "employment-income-credential": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix sec: <https://w3id.org/security#> .
@prefix schema: <https://schema.org/> .
@prefix lend: <urn:example:lend#> .
@prefix lshape: <urn:example:lend-shape#> .

# §6.2 row 2: employment + income VC issued by the income-verification seat
# (scene 1). The freshness window is REQUIRED - re-issuance is the freshness
# story; the status list signals revocation only.
lshape:EmploymentIncomeCredentialShape
  a sh:NodeShape ;
  sh:targetClass lend:EmploymentIncomeCredential ;
  sh:closed true ;
  sh:ignoredProperties ( sec:proof ) ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue cred:VerifiableCredential ;
  ] ;
  sh:property [
    sh:path cred:issuer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path cred:validFrom ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
    sh:lessThan cred:validUntil ;
  ] ;
  sh:property [
    sh:path cred:validUntil ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path cred:credentialStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
  ] ;
  sh:property [
    sh:path cred:credentialSubject ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:node lshape:EmploymentIncomeSubjectShape ;
    sh:message "credentialSubject must be the borrower WebID (holder binding)" ;
  ] ;
  sh:property [
    sh:path cred:credentialSchema ;
    sh:nodeKind sh:IRI ;
  ] .

# Employment facts plus the ZK income field. The subject must NOT carry any
# other disclosed copy of income (schema:baseSalary etc.): a disclosed
# derivative of a hidden operand defeats the ZK hiding - the closed shape
# enforces this.
lshape:EmploymentIncomeSubjectShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:ignoredProperties ( rdf:type ) ;
  sh:property [
    sh:path schema:worksFor ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:OrganizationShape ;
  ] ;
  sh:property [
    sh:path schema:jobTitle ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:minLength 1 ;
  ] ;
  sh:property [
    sh:path schema:startDate ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:date ;
  ] ;
  sh:property [
    # ZK field: whole USD/month, 4-digit budget, sparq filter_int_d4
    # (scene-2 predicate: income >= 2200).
    sh:path lend:netMonthlyIncomeUsd ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:integer ;
    sh:minInclusive 0 ;
    sh:maxInclusive 9999 ;
    sh:message "netMonthlyIncomeUsd must fit the 4-digit ZK budget (0..9999 whole USD/month)" ;
  ] .
`,
  "identity-credential": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix sec: <https://w3id.org/security#> .
@prefix schema: <https://schema.org/> .
@prefix lend: <urn:example:lend#> .
@prefix lshape: <urn:example:lend-shape#> .

# §6.2 row 1: the KYC/CIP identity VC issued once by the identity-verification
# seat (scene 1). Holder-bound: credentialSubject is the borrower WebID.
lshape:IdentityCredentialShape
  a sh:NodeShape ;
  sh:targetClass lend:IdentityCredential ;
  sh:closed true ;
  sh:ignoredProperties ( sec:proof ) ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue cred:VerifiableCredential ;
  ] ;
  sh:property [
    sh:path cred:issuer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path cred:validFrom ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
    sh:lessThan cred:validUntil ;
  ] ;
  sh:property [
    sh:path cred:validUntil ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path cred:credentialStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
  ] ;
  sh:property [
    sh:path cred:credentialSubject ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:node lshape:IdentitySubjectShape ;
    sh:message "credentialSubject must be the borrower WebID (holder binding)" ;
  ] ;
  sh:property [
    sh:path cred:credentialSchema ;
    sh:nodeKind sh:IRI ;
  ] .

# The verified identity facts. Deliberately minimal (data minimisation): the
# IDV evidence trail stays with the verifier; only the confirmed identity
# lands in the pod. The node stays untyped so no other targeted shape fires
# on it (subject shapes ignore rdf:type).
lshape:IdentitySubjectShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:ignoredProperties ( rdf:type ) ;
  sh:property [
    sh:path schema:name ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:minLength 1 ;
  ] ;
  sh:property [
    sh:path schema:birthDate ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:date ;
  ] ;
  sh:property [
    sh:path schema:address ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:PostalAddressShape ;
  ] .
`,
  "loan-offer-credential": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix sec: <https://w3id.org/security#> .
@prefix schema: <https://schema.org/> .
@prefix fibo-loan-ln-ln: <https://spec.edmcouncil.org/fibo/ontology/LOAN/LoansGeneral/Loans/> .
@prefix fibo-loan-spc-cns: <https://spec.edmcouncil.org/fibo/ontology/LOAN/LoansSpecific/ConsumerLoans/> .
@prefix lend: <urn:example:lend#> .
@prefix lshape: <urn:example:lend-shape#> .

# §6.2 row 6: the priced loan offer that lands in the borrower's pod
# (scene 3), carrying the closed-end-credit disclosure fields Reg Z
# §§1026.17-18 requires before consummation: APR, finance charge, amount
# financed (principal), total of payments and the payment schedule. The
# arithmetic identity total-of-payments = number x amount and
# finance charge = total - principal is checked by the SPARQL constraint on
# the loan node.
lshape:LoanOfferCredentialShape
  a sh:NodeShape ;
  sh:targetClass lend:LoanOfferCredential ;
  sh:closed true ;
  sh:ignoredProperties ( sec:proof ) ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue cred:VerifiableCredential ;
  ] ;
  sh:property [
    sh:path cred:issuer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    # Offers expire: validUntil is the offer's own acceptance window.
    sh:path cred:validFrom ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
    sh:lessThan cred:validUntil ;
  ] ;
  sh:property [
    sh:path cred:validUntil ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path cred:credentialStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
  ] ;
  sh:property [
    sh:path cred:credentialSubject ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:node lshape:LoanOfferSubjectShape ;
    sh:message "credentialSubject must be the borrower WebID (holder binding)" ;
  ] ;
  sh:property [
    sh:path cred:credentialSchema ;
    sh:nodeKind sh:IRI ;
  ] .

lshape:LoanOfferSubjectShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:ignoredProperties ( rdf:type ) ;
  sh:property [
    sh:path lend:hasLoanOffer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:LoanOfferTermsShape ;
  ] .

# The offered consumer instalment loan. FIBO gives the loan taxonomy
# (UnsecuredConsumerLoan, ClosedEndCredit); schema.org's financial extension
# gives APR and the repayment specification; the two TILA money aggregates
# FIBO/schema.org lack (finance charge, total of payments) are lend: residue
# terms.
lshape:LoanOfferTermsShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue fibo-loan-spc-cns:UnsecuredConsumerLoan ;
  ] ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue fibo-loan-ln-ln:ClosedEndCredit ;
  ] ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue schema:LoanOrCredit ;
  ] ;
  sh:property [
    # Amount financed (TILA §1026.18(b)) - the principal pushed to the card.
    sh:path fibo-loan-ln-ln:hasPrincipalAmount ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:MonetaryAmountShape ;
  ] ;
  sh:property [
    # APR (TILA §1026.18(e)) as a percentage, e.g. 32.90.
    sh:path schema:annualPercentageRate ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:decimal ;
    sh:minInclusive 0.0 ;
    sh:maxExclusive 100.0 ;
  ] ;
  sh:property [
    # Finance charge (TILA §1026.18(d)).
    sh:path lend:hasFinanceCharge ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:MonetaryAmountShape ;
  ] ;
  sh:property [
    # Total of payments (TILA §1026.18(h)).
    sh:path lend:hasTotalOfPayments ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:MonetaryAmountShape ;
  ] ;
  sh:property [
    sh:path lend:loanTermMonths ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:integer ;
    sh:minInclusive 1 ;
    sh:maxInclusive 120 ;
  ] ;
  sh:property [
    # Payment schedule (TILA §1026.18(g)).
    sh:path schema:loanRepaymentForm ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:RepaymentSpecificationShape ;
  ] ;
  sh:sparql [
    # Arithmetic identity (inexpressible in core SHACL): the disclosed
    # aggregates must reconcile, otherwise a plausible-looking disclosure
    # could overstate or understate the cost of credit.
    sh:message "disclosure arithmetic must hold: total of payments = payments x amount (to the cent) and finance charge = total - principal" ;
    sh:select """
      SELECT $this WHERE {
        $this <https://spec.edmcouncil.org/fibo/ontology/LOAN/LoansGeneral/Loans/hasPrincipalAmount>/<https://schema.org/value> ?principal ;
              <urn:example:lend#hasFinanceCharge>/<https://schema.org/value> ?charge ;
              <urn:example:lend#hasTotalOfPayments>/<https://schema.org/value> ?total ;
              <https://schema.org/loanRepaymentForm> ?spec .
        ?spec <https://schema.org/numberOfLoanPayments> ?n ;
              <https://schema.org/loanPaymentAmount>/<https://schema.org/value> ?payment .
        FILTER (
          ABS(?total - (?n * ?payment)) > 0.005 ||
          ABS(?charge - (?total - ?principal)) > 0.005
        )
      }
    """ ;
  ] .
`,
  persona: `# The demo persona's SHACL shape: drives deterministic synthetic data
# (@jeswr/synthetic-rdf) and validates every seeded persona resource.
# Pinned to the walkthrough persona card (Maya Torres / MT-0001) - the seeded
# pod data must match apps/tour/content/walkthrough.json. Only real
# namespaces + urn:example: local identities (no minted IRIs). Credential
# subject nodes stay deliberately UNTYPED, so this schema:Person target never
# fires on them.
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix schema: <https://schema.org/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<urn:example:shape:persona> a sh:NodeShape ;
  sh:targetClass schema:Person ;
  sh:closed true ;
  sh:ignoredProperties ( rdf:type ) ;
  sh:property [
    sh:path schema:name ;
    sh:datatype xsd:string ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:in ( "Maya Torres" ) ;
  ] ;
  sh:property [
    sh:path schema:identifier ;
    sh:datatype xsd:string ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:in ( "MT-0001" ) ;
  ] .
`,
  "repayment-history-credential": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix sec: <https://w3id.org/security#> .
@prefix schema: <https://schema.org/> .
@prefix fibo-loan-ln-ln: <https://spec.edmcouncil.org/fibo/ontology/LOAN/LoansGeneral/Loans/> .
@prefix lend: <urn:example:lend#> .
@prefix lshape: <urn:example:lend-shape#> .

# §6.2 row 8: the graduation credential (scene 5) - on-time repayment history
# issued by the servicing lender, furnished to the bureau seat and reusable
# with future lenders. Each furnishing cycle re-issues with a fresh window
# and revokes the superseded credential's status index.
lshape:RepaymentHistoryCredentialShape
  a sh:NodeShape ;
  sh:targetClass lend:RepaymentHistoryCredential ;
  sh:closed true ;
  sh:ignoredProperties ( sec:proof ) ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue cred:VerifiableCredential ;
  ] ;
  sh:property [
    sh:path cred:issuer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path cred:validFrom ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
    sh:lessThan cred:validUntil ;
  ] ;
  sh:property [
    sh:path cred:validUntil ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path cred:credentialStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
  ] ;
  sh:property [
    sh:path cred:credentialSubject ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:node lshape:RepaymentHistorySubjectShape ;
    sh:message "credentialSubject must be the borrower WebID (holder binding)" ;
  ] ;
  sh:property [
    sh:path cred:credentialSchema ;
    sh:nodeKind sh:IRI ;
  ] .

lshape:RepaymentHistorySubjectShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:ignoredProperties ( rdf:type ) ;
  sh:property [
    sh:path fibo-loan-ln-ln:hasPaymentHistory ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
    sh:node lshape:PaymentHistoryShape ;
  ] .

lshape:PaymentHistoryShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue fibo-loan-ln-ln:PaymentHistory ;
  ] ;
  sh:property [
    sh:path lend:servicedLoan ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path lend:onTimePaymentCount ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:integer ;
    sh:minInclusive 0 ;
    sh:maxInclusive 999 ;
  ] ;
  sh:property [
    sh:path lend:latePaymentCount ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:integer ;
    sh:minInclusive 0 ;
    sh:maxInclusive 999 ;
  ] ;
  sh:property [
    sh:path lend:scheduledPaymentCount ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:integer ;
    sh:minInclusive 1 ;
    sh:maxInclusive 999 ;
  ] ;
  sh:property [
    sh:path schema:startDate ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:date ;
    sh:lessThan schema:endDate ;
    sh:message "the reporting period must end after it starts" ;
  ] ;
  sh:property [
    sh:path schema:endDate ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:date ;
  ] ;
  sh:sparql [
    # Reported payments can never exceed the schedule (inexpressible in core
    # SHACL as a sum): a furnisher must not report more outcomes than the
    # loan has scheduled payments.
    sh:message "onTimePaymentCount + latePaymentCount must not exceed scheduledPaymentCount" ;
    sh:select """
      SELECT $this WHERE {
        $this <urn:example:lend#onTimePaymentCount> ?onTime ;
              <urn:example:lend#latePaymentCount> ?late ;
              <urn:example:lend#scheduledPaymentCount> ?scheduled .
        FILTER ((?onTime + ?late) > ?scheduled)
      }
    """ ;
  ] .
`,
  "zk-operand-anchor": `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix cred: <https://www.w3.org/2018/credentials#> .
@prefix sec: <https://w3id.org/security#> .
@prefix lend: <urn:example:lend#> .
@prefix lshape: <urn:example:lend-shape#> .

# The issuer-signed operand-anchor VC that makes the Tier-A live filter
# proofs of the next build round forgery-resistant. A bare filter proof is
# fully forgeable (operand_enc is deterministic and salt-free); verifiers
# MUST check anchor signature + issuer trust + status + subject WebID ==
# authenticated presenter + anchor.operandEnc == proof public input +
# challenge freshness. Never ship a Tier-A surface without the anchor check.
lshape:ZkOperandAnchorShape
  a sh:NodeShape ;
  sh:targetClass lend:ZkOperandAnchor ;
  sh:closed true ;
  sh:ignoredProperties ( sec:proof ) ;
  sh:property [
    sh:path rdf:type ;
    sh:hasValue cred:VerifiableCredential ;
  ] ;
  sh:property [
    sh:path cred:issuer ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
  ] ;
  sh:property [
    sh:path cred:validFrom ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
    sh:lessThan cred:validUntil ;
  ] ;
  sh:property [
    # Anchors are revoked via credentialStatus rather than expiring, but an
    # explicit window is permitted.
    sh:path cred:validUntil ;
    sh:maxCount 1 ;
    sh:datatype xsd:dateTime ;
  ] ;
  sh:property [
    sh:path cred:credentialStatus ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:BlankNodeOrIRI ;
  ] ;
  sh:property [
    sh:path cred:credentialSubject ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:node lshape:ZkOperandAnchorSubjectShape ;
    sh:message "credentialSubject must be the holder WebID the verifier matches against the DPoP-bound session" ;
  ] ;
  sh:property [
    sh:path cred:credentialSchema ;
    sh:nodeKind sh:IRI ;
  ] .

lshape:ZkOperandAnchorSubjectShape
  a sh:NodeShape ;
  sh:closed true ;
  sh:ignoredProperties ( rdf:type ) ;
  sh:property [
    # Only the three ZK scaled-unit fields are anchorable. This list must
    # stay equal to ZK_FIELD_BUDGETS in src/zk-budgets.ts (test-enforced).
    sh:path lend:field ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:nodeKind sh:IRI ;
    sh:in ( lend:netMonthlyIncomeUsd lend:cashFlowScoreValue lend:nsf90Count ) ;
    sh:message "field must be one of the three ZK scaled-unit field IRIs" ;
  ] ;
  sh:property [
    # Deterministic salt-free sparq term encoding: 0x-prefixed lowercase hex
    # field element, equal to the filter circuit's public operand_enc input.
    sh:path lend:operandEnc ;
    sh:minCount 1 ;
    sh:maxCount 1 ;
    sh:datatype xsd:string ;
    sh:pattern "^0x[0-9a-f]{1,64}$" ;
    sh:message "operandEnc must be a 0x-prefixed lowercase hex field element" ;
  ] .
`,
} as const;

/** Document keys of the bundled SHACL shapes. */
export type ShapesDocumentKey = keyof typeof SHAPES_TURTLE;

/** Every bundled shapes document, in one Turtle-parseable list. */
export const ALL_SHAPES_DOCUMENTS: readonly string[] = Object.values(SHAPES_TURTLE);

/** File stem of the 12 bundled shapes documents. */
export const SHAPES_DOCUMENT_KEYS = Object.keys(SHAPES_TURTLE) as readonly ShapesDocumentKey[];
