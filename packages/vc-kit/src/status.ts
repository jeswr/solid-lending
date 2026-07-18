/**
 * Bitstring Status List hosting (one
 * list per issuer app, decision 0007: status = revocation only, never
 * freshness). Built on solid-vc's fail-closed Bitstring implementation:
 *
 * - the hosted document is the SIGNED `BitstringStatusListCredential` as VC 2.0
 *   JSON-LD (the exact shape solid-vc's `resolveBitstringStatus` consumes,
 *   id-equals-URL checked, purpose-matched, signature-verified, zip-bomb
 *   bounded);
 * - writes go through the caller-supplied fetch (the pod harness / issuer app
 *   session) with `If-None-Match: *` on create and `If-Match` on update;
 * - issuer-side index allocation is DETERMINISTIC (sha-256 of a caller seed,
 *   linear probing on collision) so re-seeding a demo pod reproduces the same
 *   indices.
 */

import { createHash } from "node:crypto";
import {
  type BitstringStatusListEntry,
  bitstringStatusListEntry,
  buildBitstringStatusListCredential,
  createStatusBitstring,
  getStatusBit,
  issue,
  type KeyPair,
  MIN_STATUS_LIST_LENGTH,
  setStatusBit,
  statusListBitsOf,
  VC_V2_CONTEXT,
  type VerifiableCredential,
  verifyCredential as verifyVcObject,
} from "@jeswr/solid-vc";

export { MIN_STATUS_LIST_LENGTH };

/** A structured status-list operation failure (always thrown, never a pass). */
export class StatusListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatusListError";
  }
}

export interface DeriveStatusIndexOptions {
  /** List capacity in bits. Default: the spec minimum (131,072). */
  readonly listLength?: number;
  /** Occupied-index predicate for collision probing. Default: nothing taken. */
  readonly isTaken?: (index: number) => boolean;
}

/**
 * Deterministic issuer-side index allocation: sha-256(seed) folded to an index
 * in `[0, listLength)`, then LINEAR PROBING past occupied indices. The same
 * seed over the same occupancy always yields the same index; a full list
 * throws (fail-closed) rather than silently reusing an index.
 */
export function deriveStatusIndex(seed: string, options: DeriveStatusIndexOptions = {}): number {
  const listLength = options.listLength ?? MIN_STATUS_LIST_LENGTH;
  if (!Number.isSafeInteger(listLength) || listLength <= 0) {
    throw new StatusListError(`listLength must be a positive integer: ${listLength}`);
  }
  const digest = createHash("sha256").update(seed, "utf8").digest();
  const start = Number(digest.readBigUInt64BE(0) % BigInt(listLength));
  const isTaken = options.isTaken ?? (() => false);
  for (let probe = 0; probe < listLength; probe += 1) {
    const index = (start + probe) % listLength;
    if (!isTaken(index)) return index;
  }
  throw new StatusListError(`status list is full (${listLength} indices allocated)`);
}

/**
 * In-memory occupancy tracker for one issuer's list: allocation stays
 * deterministic per seed while guaranteeing no two live credentials share an
 * index (collision-probed).
 */
export class StatusIndexAllocator {
  readonly listLength: number;
  private readonly taken = new Set<number>();

  constructor(listLength: number = MIN_STATUS_LIST_LENGTH) {
    this.listLength = listLength;
  }

  allocate(seed: string): number {
    const index = deriveStatusIndex(seed, {
      listLength: this.listLength,
      isTaken: (candidate) => this.taken.has(candidate),
    });
    this.taken.add(index);
    return index;
  }

  /** Mark an index occupied (e.g. rehydrating allocator state from a pod). */
  reserve(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.listLength) {
      throw new StatusListError(`index ${index} is outside the ${this.listLength}-bit list`);
    }
    this.taken.add(index);
  }

  release(index: number): void {
    this.taken.delete(index);
  }
}

export interface StatusListClientOptions {
  /** The URL the signed list is hosted at (and its credential `id`). */
  readonly url: string;
  /** The issuer WebID (signs the list; default trust anchor for its entries). */
  readonly issuer: string;
  /** The issuer's signing key. */
  readonly key: KeyPair;
  /** What a set bit means for this list. Default `"revocation"` (decision 0007). */
  readonly statusPurpose?: "revocation" | "suspension";
  /** The fetch that reads/writes the hosted resource (harness / issuer session). */
  readonly fetch: typeof fetch;
  /** Ceiling on the decoded bitstring when reading back (zip-bomb guard). */
  readonly maxDecodedBytes?: number;
}

/** Explicit timestamps for a list write - vc-kit never reads the clock. */
export interface StatusListWriteOptions {
  /** The write instant: list `validFrom` + proof `created`. */
  readonly now: Date;
  /**
   * List expiry. Default: `now` + 24h (presentation-protocol section 3: a
   * stale cached list fails closed).
   */
  readonly validUntil?: Date;
}

/**
 * The W3C Bitstring Status List media type. Deliberately NOT
 * `application/ld+json`: the hosted document carries the remote VC 2.0
 * `@context`, and an SSRF-guarded pod (correctly) refuses to parse JSON-LD
 * with a remote context on PUT - `application/vc+ld+json` stores byte-exact.
 */
const LIST_CONTENT_TYPE = "application/vc+ld+json";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One issuer app's hosted Bitstring Status List: create, revoke/reinstate
 * (read-verify-modify-resign-PUT), entry construction for issuance, and a
 * direct bit read. All mutations re-sign the whole list credential - a stale
 * or tampered hosted document is refused, never patched over.
 */
export class StatusListClient {
  readonly url: string;
  readonly issuer: string;
  readonly statusPurpose: "revocation" | "suspension";
  private readonly key: KeyPair;
  private readonly fetchImpl: typeof fetch;
  private readonly maxDecodedBytes: number | undefined;

  constructor(options: StatusListClientOptions) {
    this.url = new URL(options.url).href;
    this.issuer = options.issuer;
    this.statusPurpose = options.statusPurpose ?? "revocation";
    this.key = options.key;
    this.fetchImpl = options.fetch;
    this.maxDecodedBytes = options.maxDecodedBytes;
  }

  /** The `credentialStatus` entry for a credential occupying `index`. */
  entry(index: number): BitstringStatusListEntry {
    return bitstringStatusListEntry({
      statusPurpose: this.statusPurpose,
      statusListIndex: index,
      statusListCredential: this.url,
    });
  }

  /** Create + host the all-clear signed list (strict create - never overwrites). */
  async create(options: StatusListWriteOptions & { bits?: Uint8Array }): Promise<void> {
    const signed = await this.signList(options.bits ?? createStatusBitstring(), options);
    const response = await this.fetchImpl(this.url, {
      method: "PUT",
      headers: { "content-type": LIST_CONTENT_TYPE, "if-none-match": "*" },
      body: serializeList(signed),
    });
    if (!response.ok) {
      throw new StatusListError(`status list create PUT ${this.url} failed: ${response.status}`);
    }
  }

  /** Set the bit for `index` (revoke under a `"revocation"` list). */
  async revoke(index: number, options: StatusListWriteOptions): Promise<void> {
    await this.writeBit(index, true, options);
  }

  /** Clear the bit for `index` (reinstate). */
  async reinstate(index: number, options: StatusListWriteOptions): Promise<void> {
    await this.writeBit(index, false, options);
  }

  /** Read the CURRENT hosted bit for `index` (signature-verified read). */
  async readBit(index: number, options: { readonly now: Date }): Promise<boolean> {
    const { bits } = await this.readVerified(options.now);
    if (index < 0 || index >= bits.length * 8) {
      throw new StatusListError(`index ${index} is outside the ${bits.length * 8}-bit list`);
    }
    return getStatusBit(bits, index);
  }

  private async writeBit(
    index: number,
    value: boolean,
    options: StatusListWriteOptions,
  ): Promise<void> {
    const { bits, etag } = await this.readVerified(options.now);
    if (index < 0 || index >= bits.length * 8) {
      throw new StatusListError(`index ${index} is outside the ${bits.length * 8}-bit list`);
    }
    setStatusBit(bits, index, value);
    const signed = await this.signList(bits, options);
    if (etag === null) {
      // Fail closed rather than unconditional-PUT: without If-Match a
      // concurrent revocation would be silently overwritten (lost update).
      throw new StatusListError(
        `status list GET ${this.url} returned no ETag - refusing an unconditional overwrite`,
      );
    }
    const response = await this.fetchImpl(this.url, {
      method: "PUT",
      headers: { "content-type": LIST_CONTENT_TYPE, "if-match": etag },
      body: serializeList(signed),
    });
    if (!response.ok) {
      throw new StatusListError(
        `status list update PUT ${this.url} failed: ${response.status}${response.status === 412 ? " (concurrent update - retry)" : ""}`,
      );
    }
  }

  /**
   * Fetch the hosted list and verify OUR OWN signature over it before trusting
   * its bits for a mutation - a tampered or foreign-signed hosted document is
   * refused (fail-closed), never silently re-signed.
   */
  private async readVerified(now: Date): Promise<{ bits: Uint8Array; etag: string | null }> {
    const response = await this.fetchImpl(this.url, {
      headers: { accept: `${LIST_CONTENT_TYPE}, application/json;q=0.9` },
    });
    if (!response.ok) {
      throw new StatusListError(`status list GET ${this.url} failed: ${response.status}`);
    }
    const etag = response.headers.get("etag");
    let document: unknown;
    try {
      document = JSON.parse(await response.text());
    } catch {
      throw new StatusListError(`hosted status list at ${this.url} is not valid JSON`);
    }
    const listVc = stripContext(document);
    const outcome = await verifyVcObject(listVc, {
      resolveKey: async (verificationMethod) =>
        verificationMethod === this.key.verificationMethod ? this.key.publicKey : undefined,
      isControlledBy: (verificationMethod, issuer) =>
        verificationMethod === this.key.verificationMethod && issuer === this.issuer,
      trustedIssuers: [this.issuer],
      now,
    });
    // An EXPIRED window on OUR OWN hosted list is expected staleness (the
    // issuer is about to re-sign it with a fresh window) - integrity failures
    // (signature, issuer binding, structure) still refuse the mutation.
    const onlyExpired =
      outcome.errors.length > 0 && outcome.errors.every((error) => error.code === "EXPIRED");
    if (!outcome.verified && !onlyExpired) {
      throw new StatusListError(
        `hosted status list at ${this.url} failed verification (${outcome.errors.map((error) => error.code).join(", ")}) - refusing to mutate it`,
      );
    }
    const bits = statusListBitsOf(
      listVc,
      this.maxDecodedBytes !== undefined ? { maxDecodedBytes: this.maxDecodedBytes } : {},
    );
    return { bits, etag };
  }

  private async signList(
    bits: Uint8Array,
    options: StatusListWriteOptions,
  ): Promise<VerifiableCredential> {
    const validUntil = options.validUntil ?? new Date(options.now.getTime() + DAY_MS);
    const credential = buildBitstringStatusListCredential({
      id: this.url,
      issuer: this.issuer,
      statusPurpose: this.statusPurpose,
      bits,
      validFrom: options.now.toISOString(),
      validUntil: validUntil.toISOString(),
    });
    return issue({
      credential,
      key: this.key,
      options: { created: options.now },
    });
  }
}

/** The hosted body: the signed list credential as VC 2.0 JSON-LD. */
function serializeList(signed: VerifiableCredential): string {
  return JSON.stringify({ "@context": [VC_V2_CONTEXT], ...signed }, null, 2);
}

function stripContext(document: unknown): VerifiableCredential {
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    throw new StatusListError("hosted status list is not a JSON object");
  }
  const { "@context": _context, ...rest } = document as Record<string, unknown>;
  return rest as unknown as VerifiableCredential;
}
