/**
 * The bureau's furnished-tradelines ledger (design §6.1/§6.2 scene 5 — the
 * credit-graduation close). KNOWN DEMO-SCOPE LIMIT: records live in an
 * in-memory, process-local ledger, not a pod resource — no SHACL shape for
 * "furnished tradeline" exists yet in `@lending/data-model` (a follow-up
 * would define one and persist it into the bureau's own pod, mirroring the
 * wallet's `dpv:ConsentReceipt` ledger). Every record here was produced by a
 * REAL `verifyCredential` pass (signature + shape + window + status +
 * trusted issuer + subject binding) before it was ever recorded — nothing is
 * ever written on a failed verification.
 */

export interface FurnishedRecord {
  /** The furnished credential's pod-resource IRI (dedup key). */
  readonly credentialId: string;
  /** The AUTHENTICATED borrower this tradeline is furnished for. */
  readonly subject: string;
  /** The furnisher's WebID (the verified `issuer` of the presented VC). */
  readonly issuer: string;
  readonly servicedLoan: string;
  readonly onTimePaymentCount: number;
  readonly latePaymentCount: number;
  readonly scheduledPaymentCount: number;
  /** ISO instant this bureau recorded the furnishing (not the VC's own validity window). */
  readonly furnishedAt: string;
}

export interface FurnishedStore {
  /** Whether `subject` already has a record for `credentialId` (idempotency gate). */
  has(subject: string, credentialId: string): boolean;
  /** Record a newly-verified furnishing. Callers MUST check `has()` first. */
  add(record: FurnishedRecord): void;
  /** Every tradeline furnished for `subject`, oldest first — never another borrower's. */
  list(subject: string): readonly FurnishedRecord[];
}

/** A fresh, empty, process-local ledger. */
export function createFurnishedStore(): FurnishedStore {
  const bySubject = new Map<string, FurnishedRecord[]>();

  return {
    add(record) {
      const existing = bySubject.get(record.subject);
      if (existing === undefined) {
        bySubject.set(record.subject, [record]);
        return;
      }
      existing.push(record);
    },
    has(subject, credentialId) {
      return (bySubject.get(subject) ?? []).some((entry) => entry.credentialId === credentialId);
    },
    list(subject) {
      return [...(bySubject.get(subject) ?? [])];
    },
  };
}
