# Small-Dollar Lending Walkthrough

A multistakeholder pod-data walkthrough scaffolded by **create-solid-demo**: a
pnpm + Turborepo monorepo whose tour shell renders entirely from ONE JSON
document, with a skeleton app per ecosystem seat.

> Concept demonstration by EDMA Solid Community of Practice. All data is simulated — no surface
> in this repo may present itself as a real service.

## Layout

| Path | App | Role |
|---|---|---|
| `apps/tour` | Small-Dollar Lending Tour (shell) | walkthrough shell |
| `apps/wallet` | Data Vault | borrower data vault |
| `apps/verifications` | Verification Center | identity, income, and cash-flow credential issuer |
| `apps/bank-lender` | Personal Loan Desk | bank installment lender |
| `apps/fintech-lender` | Installment Lending | cash-flow-underwriting installment lender |
| `apps/bureau` | Credit File | credit bureau |
| `apps/disbursement` | Instant Payout | instant disbursement rail |

Plus `packages/data-model` (SHACL shapes + vocab stub), `seeds/` (deterministic
persona seeding via @jeswr/synthetic-rdf + @jeswr/solid-seed), `e2e/` (Playwright
disclaimer + axe gates), and `scripts/` (IRI + insignia lints).

## The single edit surface

`apps/tour/content/walkthrough.json` drives the WHOLE tour — landing copy,
ecosystem map, launcher, chapters, themes, honesty panels, deploy wiring. Edit it,
run `pnpm test`, and the site follows. The schema and the editorial gates are
enforced by `parseWalkthrough` / `editorialFindings` from @jeswr/solid-showcase.

## Quickstart

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @lending/app-tour dev     # the shell on :3000
```

> **Framework dependency status:** the @jeswr framework packages
> (solid-showcase, solid-showcase-kit, solid-pod-guard, synthetic-rdf,
> solid-seed) are pending their npm publish. This repo vendors their packed
> tarball closure under `vendor/` and pins them via `pnpm.overrides` `file:`
> entries — see docs/framework-deps.md for provenance and the un-pin steps.

## Seed

`pnpm run seed` generates the deterministic demo persona (seeds/persona.ts —
keep it in sync with `walkthrough.persona`) and writes it to the pod named by
`LENDING_SEED_POD_URL` / `LENDING_SEED_WEBID`.

## Deploy

One Vercel project per app from this single repo — read `docs/deploy.md` before
creating any project; it carries the env matrix and the hard-won gotchas
(rootDirectory, cleared overrides, forwarded-headers trust, preview posture,
neutral slugs).
