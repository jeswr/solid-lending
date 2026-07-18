/**
 * A SELF-HOSTED demo operand-anchor issuer for the scene-2 pre-qualification
 * walkthrough (`app/prequal/page.tsx`, `lib/server/prequal.ts`).
 *
 * HONESTY: in the full multi-app deployment, Maya's operand-anchor VCs are
 * issued once by `verifications` (the bank-cash-flow/cash-flow-score/income
 * issuer seat) and read from HER OWN pod by her browser session — this app
 * only VERIFIES the resulting proof. Standing up that cross-app session
 * plumbing is the `wallet`/`verifications` apps' slice, not this one's. So
 * that the Personal Loan Desk's OWN walkthrough page is still a genuine,
 * non-mocked round trip end to end, this module signs the SAME three anchors
 * (income/cash-flow-score/NSF90) itself, with a FRESH per-process Ed25519 key
 * and a REAL hosted Bitstring status list — every credential this issues is a
 * REAL `eddsa-rdfc-2022`-signed VC that passes vc-kit's full fail-closed
 * `verifyCredential` gate chain (signature, shape, window, status), exactly
 * like a production issuer's would. It is marked `simulated: true` everywhere
 * it surfaces and is ADDITIVE to `trustedAnchorIssuers` — an operator
 * pointing this app at the real `verifications` deployment loses nothing by
 * leaving it configured.
 *
 * Scene 2 asks the SAME three predicates the fintech-lender sibling verifies
 * (design §6: both competing lenders check `income >= $2,200/mo`, `cash-flow
 * score >= 660`, `NSF90 = 0`) — the shopping proof is lender-agnostic by
 * design. Witness values are Maya Torres's PINNED persona figures
 * (`@lending/data-model` `PERSONA_VALUES`) — the walkthrough's one played
 * persona — never a live pod read. The operand encodings are the CAPTURED
 * genuine sparq `encode_int_literal` outputs for those exact values (never
 * fabricated; same table + provenance `seeds/captured-operand-enc.ts` carries,
 * duplicated here per that module's own precedent: vc-kit's fixture is a TEST
 * asset, not a package export, so every consumer across this workspace that
 * needs it cites and copies it rather than reaching across the package
 * boundary).
 */
import {
  type CredentialClaims,
  generateKeyPairForSuite,
  issueCredential,
  type IssuedCredential,
  type KeyPair,
  type PreQualificationField,
  StatusListClient,
} from "@lending/vc-kit";
import { LEND, PERSONA_VALUES, ZK_PREQUAL_THRESHOLDS } from "@lending/data-model";

/**
 * PROVENANCE: genuine sparq term encodings of `"<value>"^^xsd:integer` from
 * `sparq_zk_compose::build::encode_int_literal`, captured against sparq
 * commit `947480b02fcbd174f80f9247b55ee02202d2e345` — copied verbatim from
 * `packages/vc-kit/test/fixtures/operand-enc.json` (a vc-kit TEST fixture,
 * not a package export). NEVER hand-edit; recapture with the native toolchain
 * instead (`packages/vc-kit/scripts/capture-fixtures.mjs`).
 */
const CAPTURED_OPERAND_ENC: Readonly<Record<number, string>> = {
  0: "0x17371a31fd5b665a45225290dde2708b5a90e4181a6cffc057103fb7a5b19c66",
  660: "0x0ce59c1353ad4549d10c4e684dc616a86df4294d0bbe4e22e149d9a5a8637437",
  720: "0x03991f97cea18f61d22cb2f762ddddfdfb03ed9ad32625cbbb3962bb2d59e59e",
  2200: "0x1c1ba019a5ac42ec772999f33f1dbc57480afa339b59ba064cce4da00b82fc54",
  2860: "0x07b66a6df9e52198d3d823f29c5030fd9721dafcf31b7a44da67a0f21d3710b0",
};

function capturedEncoding(value: number): string {
  const encoding = CAPTURED_OPERAND_ENC[value];
  if (encoding === undefined) {
    throw new Error(`no captured operand encoding for ${value} — encodings are never fabricated`);
  }
  return encoding;
}

const FIELD_IRI: Readonly<Record<PreQualificationField, string>> = {
  cashFlowScoreValue: LEND.cashFlowScoreValue,
  netMonthlyIncomeUsd: LEND.netMonthlyIncomeUsd,
  nsf90Count: LEND.nsf90Count,
};

/** Maya's pinned witness values, one per pre-qualification field (design §5). */
export function demoWitnessValues(): Readonly<Record<PreQualificationField, number>> {
  const persona = PERSONA_VALUES[0];
  if (persona === undefined) throw new Error("no demo persona available");
  return {
    cashFlowScoreValue: persona.cashFlowScoreValue,
    netMonthlyIncomeUsd: persona.netMonthlyIncomeUsd,
    nsf90Count: persona.nsf90Count,
  };
}

/** Sanity-check the pinned witness clears every scene-2 threshold (test-enforced too). */
export function assertWitnessClearsThresholds(): void {
  const values = demoWitnessValues();
  if (values.netMonthlyIncomeUsd < ZK_PREQUAL_THRESHOLDS.netMonthlyIncomeUsd) {
    throw new Error("demo witness income does not clear the scene-2 threshold");
  }
  if (values.cashFlowScoreValue < ZK_PREQUAL_THRESHOLDS.cashFlowScoreValue) {
    throw new Error("demo witness cash-flow score does not clear the scene-2 threshold");
  }
  if (values.nsf90Count !== ZK_PREQUAL_THRESHOLDS.nsf90Count) {
    throw new Error("demo witness NSF90 does not equal the scene-2 predicate");
  }
}

/** In-memory GET host for the demo issuer's own status list (nothing leaves the process). */
function memoryStatusHost(): { fetch: typeof fetch } {
  const resources = new Map<string, { body: string; contentType: string; version: number }>();
  const memoryFetch: typeof fetch = async (input, init) => {
    const request = new Request(input instanceof Request ? input : String(input), init);
    const key = new URL(request.url).href;
    const existing = resources.get(key);
    if (request.method === "PUT") {
      if (request.headers.get("if-none-match") === "*" && existing !== undefined) {
        return new Response(null, { status: 412 });
      }
      const body = await request.text();
      resources.set(key, {
        body,
        contentType: request.headers.get("content-type") ?? "application/octet-stream",
        version: (existing?.version ?? 0) + 1,
      });
      return new Response(null, { status: existing === undefined ? 201 : 204 });
    }
    if (existing === undefined) return new Response("not found", { status: 404 });
    return new Response(existing.body, {
      headers: { "content-type": existing.contentType, etag: `"v${existing.version}"` },
      status: 200,
    });
  };
  return { fetch: memoryFetch };
}

export interface DemoIssuer {
  readonly webId: string;
  readonly key: KeyPair;
  /** The in-memory fetch verifiers must use as `statusFetch` to resolve this issuer's list. */
  readonly statusFetch: typeof fetch;
  /**
   * Sign one operand-anchor VC for `field`, bound to `subject`, valid at
   * `now`. Returns the issued credential ALONGSIDE the plaintext
   * `operandEnc` it just anchored (the caller needs it to build the matching
   * ZK proof — re-parsing it back out of the signed Turtle is unnecessary
   * and fragile).
   */
  anchorFor(
    field: PreQualificationField,
    subject: string,
    now: Date,
  ): Promise<{ readonly credential: IssuedCredential; readonly operandEnc: string }>;
}

let cached: Promise<DemoIssuer> | undefined;

/** Lazily provision the process-wide demo issuer (one fresh key + list per process boot). */
export function demoIssuer(): Promise<DemoIssuer> {
  cached ??= (async () => {
    const webId = "https://bank-lender.example/orgs/demo-prequal-issuer#id";
    const origin = new URL(webId).origin;
    const key = await generateKeyPairForSuite(
      `${origin}/orgs/demo-prequal-issuer#key-1`,
      "Ed25519",
    );
    const host = memoryStatusHost();
    const statusUrl = `${origin}/status/prequal-anchors`;
    const list = new StatusListClient({ fetch: host.fetch, issuer: webId, key, url: statusUrl });
    const values = demoWitnessValues();
    // Memoized as a SHARED PROMISE, not a boolean flag: `anchorFor` is called
    // concurrently (Promise.all over the three pre-qual legs), and a flag
    // checked-then-set non-atomically would let two concurrent calls both
    // observe "not yet created" and race a second `list.create()` PUT — which
    // fails 412 (the list already exists by the time it lands).
    let creation: Promise<void> | undefined;
    let indexSeq = 0;
    return {
      key,
      statusFetch: host.fetch,
      webId,
      async anchorFor(field, subject, now) {
        creation ??= list.create({ now });
        await creation;
        indexSeq += 1;
        const operandEnc = capturedEncoding(values[field]);
        const claims: CredentialClaims = {
          field: FIELD_IRI[field],
          kind: "zk-operand-anchor",
          operandEnc,
        };
        const credential = await issueCredential({
          claims,
          credentialId: `${origin}/anchors/${field}-${indexSeq}`,
          issuer: webId,
          key,
          kind: "zk-operand-anchor",
          status: list.entry(indexSeq),
          subject,
          validity: {
            validFrom: new Date(now.getTime() - 60_000),
            validUntil: new Date(now.getTime() + 900_000),
          },
        });
        return { credential, operandEnc };
      },
    };
  })();
  return cached;
}

/** Test-only: force a fresh demo issuer on the next call. */
export function __resetDemoIssuerForTests(): void {
  cached = undefined;
}
