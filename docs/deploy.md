# Deploying the Lending walkthrough

One shared domain, N zone apps behind the shell's rewrites (the browser-storage
partitioning constraint), one Vercel project per app from this single monorepo.
These are hard-won learnings — read them BEFORE creating any project.

## Project matrix

| app dir | package | Vercel project | production URL |
|---|---|---|---|
| `apps/tour` | `@lending/app-tour` | `solid-lending` | https://solid-lending.vercel.app |
| `apps/wallet` | `@lending/app-wallet` | `solid-lending-wallet` | https://solid-lending-wallet.vercel.app |
| `apps/verifications` | `@lending/app-verifications` | `solid-lending-verifications` | https://solid-lending-verifications.vercel.app |
| `apps/bank-lender` | `@lending/app-bank-lender` | `solid-lending-bank-lender` | https://solid-lending-bank-lender.vercel.app |
| `apps/fintech-lender` | `@lending/app-fintech-lender` | `solid-lending-fintech-lender` | https://solid-lending-fintech-lender.vercel.app |
| `apps/bureau` | `@lending/app-bureau` | `solid-lending-bureau` | https://solid-lending-bureau.vercel.app |
| `apps/disbursement` | `@lending/app-disbursement` | `solid-lending-disbursement` | https://solid-lending-disbursement.vercel.app |

## Per-app Vercel projects

- **`rootDirectory` = `apps/<slug>`** on EVERY project. A Git-integration
  auto-created project without it builds the repo root and fails; a single-app
  CLI deploy from inside the app directory fails too. Create each project
  explicitly with the root directory set.
- **CLEAR the project-level build/output overrides.** A project-level
  `buildCommand` silently WINS over the checked-in `vercel.json`; the committed
  `vercel.json` (turbo-filtered build + `turbo-ignore`) must be the only build
  configuration.
- `ignoreCommand: npx turbo-ignore --fallback=HEAD^1` means a push rebuilds only
  affected apps.
- Deploy the complete monorepo from a Git worktree root. This account's Hobby seat
  blocks CLI deploys that carry an unrecognised checkout commit author; a worktree's
  `.git` pointer prevents that metadata from being attached.

## Env matrix

Zone-URL vars are read at **build time** by the shell's rewrites — changing one
requires a shell redeploy, and the shell project's env allowlist must include
them. Regenerate this table from the document with `envMatrix(doc)` from
`@jeswr/solid-showcase/next` whenever the registry changes.

| Variable | Vercel project(s) | Value | Purpose |
|---|---|---|---|
| `LENDING_WALLET_ZONE_URL` | tour (shell) | `https://<deployment>` | Production URL of Data Vault, no trailing slash — read at BUILD time by the shell's zone rewrites. |
| `LENDING_VERIFICATIONS_ZONE_URL` | tour (shell) | `https://<deployment>` | Production URL of Verification Center, no trailing slash — read at BUILD time by the shell's zone rewrites. |
| `LENDING_BANK_LENDER_ZONE_URL` | tour (shell) | `https://<deployment>` | Production URL of Personal Loan Desk, no trailing slash — read at BUILD time by the shell's zone rewrites. |
| `LENDING_FINTECH_LENDER_ZONE_URL` | tour (shell) | `https://<deployment>` | Production URL of Installment Lending, no trailing slash — read at BUILD time by the shell's zone rewrites. |
| `LENDING_BUREAU_ZONE_URL` | tour (shell) | `https://<deployment>` | Production URL of Credit File, no trailing slash — read at BUILD time by the shell's zone rewrites. |
| `LENDING_DISBURSEMENT_ZONE_URL` | tour (shell) | `https://<deployment>` | Production URL of Instant Payout, no trailing slash — read at BUILD time by the shell's zone rewrites. |
| `LENDING_TRUST_FORWARDED_HEADERS` | wallet, verifications, bank-lender, fintech-lender, bureau, disbursement | `1` | Trust proxy-forwarded host headers on authenticated pod routes; without it the proof-bound request URL is computed from the internal host and every authenticated call is rejected. |
| `LENDING_TRUSTED_OIDC_ISSUERS` | wallet, verifications, bank-lender, fintech-lender, bureau, disbursement | `https://<deployment>` | Comma-separated Solid-OIDC issuers trusted to mint caller tokens. The pod-guard rail fails closed (503) while unset. |
| `LENDING_POD_ALLOWED_ORIGINS` | wallet, verifications, bank-lender, fintech-lender, bureau, disbursement | `https://<deployment>` | Comma-separated pod ORIGINS server-side pod IO may touch (SSRF allowlist). Fails closed while unset. |

- **`LENDING_TRUST_FORWARDED_HEADERS=1` is REQUIRED on every app with
  an authenticated pod route** deployed behind a TLS-terminating proxy (Vercel):
  the DPoP proof binds the PUBLIC request URL, so without the forwarded host the
  guard reconstructs the internal URL and every authenticated call fails closed.
- The pod-guard allowlists (`*_TRUSTED_OIDC_ISSUERS`, `*_POD_ALLOWED_ORIGINS`)
  fail closed: unset ⇒ the rail answers 503, never an open door.

## Preview posture

Decide ONE gate per environment: either Vercel preview protection (SSO) guards
preview URLs, or the consent interstitial is the gate on public demos. Never
disable both. Production demo surfaces stay public *with* the interstitial and
`noindex` metadata (the showcase metadata helper sets it; keep it).

## Neutral slugs (honest branding)

Hostnames, Vercel project names, and app slugs derive from ROLES (`vault`,
`permits`, …), never from modelled-on organisation names — an org mark in a
hostname reads as endorsement. The registry's `modelledOn` text is the ONLY
place the organisation is named, always as "modelled on".

## Framework dependency status

The @jeswr framework packages (`solid-showcase`, `solid-showcase-kit`,
`solid-pod-guard`, `synthetic-rdf`, `solid-seed`) are pending their npm publish.
Until they are on the registry, `pnpm install` (locally, in CI, and on Vercel)
needs them pinned to packed tarballs or git mirrors via `pnpm.overrides` in the
root `package.json`, e.g.:

```json
{
  "pnpm": {
    "overrides": {
      "@jeswr/solid-showcase": "file:./vendor/jeswr-solid-showcase-0.1.0.tgz"
    }
  }
}
```

Remove the overrides once the packages are published.
