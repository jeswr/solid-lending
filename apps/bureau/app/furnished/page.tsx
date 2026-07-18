/**
 * Scene 5 (the credit-graduation close): the bureau's furnishing recipient
 * view. A lender furnishes a Repayment-History VC by presenting it to
 * `POST /api/furnish` — verified end to end (signature, shape, validity,
 * status, trusted issuer, subject binding) before it is ever recorded here.
 */
import { FurnishedPanel } from "../../components/furnished-panel";
import { app } from "../../lib/walkthrough";

export default function FurnishedPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-10 pb-28">
      <section>
        <p className="text-sm uppercase tracking-[0.2em]" style={{ color: "var(--primary)" }}>
          credit bureau
        </p>
        <h1 className="mt-2 font-semibold text-3xl tracking-tight">
          Furnished tradelines — building the file
        </h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          Scene 5 — repay, build, stay in control. On-time payments issue a Repayment-History VC the
          servicing lender furnishes toward the bureau — the credit-graduation beat (1.1M+
          first-time credit histories built this way in the market this seat is modelled on).
          Modelled on the {app.modelledOn} role; simulated data only.
        </p>
      </section>

      <section aria-labelledby="furnish-contract">
        <h2 className="font-semibold text-xl" id="furnish-contract">
          What this endpoint checks
        </h2>
        <ul className="mt-4 grid list-none gap-3 p-0 text-sm">
          <li className="rounded-lg border border-border bg-card p-4">
            <strong>Real verification</strong> — signature (eddsa-rdfc-2022), the
            <code> repayment-history-credential</code> SHACL shape, the validity window, and
            Bitstring status, exactly like the "old rail"'s own verifier.
          </li>
          <li className="rounded-lg border border-border bg-card p-4">
            <strong>Trusted furnisher</strong> — the credential's issuer must be on this bureau's
            operator-configured furnisher allowlist. An untrusted issuer is refused.
          </li>
          <li className="rounded-lg border border-border bg-card p-4">
            <strong>Subject binding</strong> — the credential must attest the AUTHENTICATED caller
            presenting it. A fully valid credential about someone else is never admitted.
          </li>
        </ul>
      </section>

      <FurnishedPanel />
    </div>
  );
}
