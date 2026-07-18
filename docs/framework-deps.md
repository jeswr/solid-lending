<!-- AUTHORED-BY Claude Fable 5 -->

# Framework dependency status — vendored tarballs

The @jeswr Solid showcase framework packages this repo consumes are **not yet on
npm** (their publish is a separately gated step, tracked as sm-50 in the
solid-mortgage workspace). Until they land on the registry, this repo vendors the
framework's **packed tarball closure** under `vendor/` and pins every framework
package to its tarball via `pnpm.overrides` `file:` entries in the root
`package.json` — the same mechanism the scaffolder's own
`test/scaffold-verify.test.ts` uses: a REAL install of real tarballs, not a faked
registry.

## Provenance

Each tarball was produced by `pnpm pack` from the `jeswr/solid-sdk` workspace
(each package built with its own `pnpm run build` first). The closure is the five
packages the generated repo consumes directly plus their unpublished
`workspace:` transitives:

| Tarball | Package | Why it is here |
|---|---|---|
| `jeswr-solid-showcase-0.1.0.tgz` | `@jeswr/solid-showcase` | walkthrough schema/renderer (direct) |
| `jeswr-solid-showcase-kit-0.1.0.tgz` | `@jeswr/solid-showcase-kit` | trust surfaces / branding kit (direct) |
| `jeswr-solid-pod-guard-0.1.0.tgz` | `@jeswr/solid-pod-guard` | fail-closed pod-route guard (direct) |
| `jeswr-synthetic-rdf-0.1.0.tgz` | `@jeswr/synthetic-rdf` | deterministic SHACL-valid seed data (direct) |
| `jeswr-solid-seed-0.1.0.tgz` | `@jeswr/solid-seed` | pod layout seeding (direct) |
| `jeswr-app-shell-0.1.0.tgz` | `@jeswr/app-shell` | transitive of solid-showcase(-kit) |
| `jeswr-guarded-fetch-0.1.0.tgz` | `@jeswr/guarded-fetch` | transitive of solid-pod-guard |
| `jeswr-solid-api-auth-0.1.0.tgz` | `@jeswr/solid-api-auth` | transitive of solid-pod-guard |
| `jeswr-rdf-serialize-0.1.0.tgz` | `@jeswr/rdf-serialize` | transitive of synthetic-rdf / solid-seed |
| `jeswr-solid-server-0.1.0.tgz` | `@jeswr/solid-server` | dev/test Solid server (`packages/test-kit`; direct) |

### `@jeswr/solid-server` provenance (seeder round)

Copied byte-for-byte from the solid-mortgage workspace's own vendored copy
(`packages/solid-kit/vendor/jeswr-solid-server-0.1.0.tgz` in `jeswr/solid-mortgage`),
which built it from a `sparq-org/sparq` checkout:

| Field | Value |
| --- | --- |
| Package | `@jeswr/solid-server@0.1.0` |
| Tarball | `jeswr-solid-server-0.1.0.tgz` (800095 bytes, sha256 `05f603d7a3320ffcb222703e4ba2ecbf913f18657c4c2eddaf28a80528b4db8d`) |
| sparq source | <https://github.com/sparq-org/sparq> @ `947480b02fcbd174f80f9247b55ee02202d2e345` |
| Build command | `npm --workspace @jeswr/solid-server run build:lws-wasm` (full tier) then `npm pack --ignore-scripts` |

This repo consumes only the package's top-level `.` export (`startSolidServer`) for
the Node dev/test harness (`packages/test-kit`) — the solid-mortgage `./http`/`./wasm`
subpath patch (browser-pod WASM hosting) is NOT needed here and is NOT applied; no
`pnpm.patchedDependencies` entry exists for this package in this repo.

## When the framework hits npm

1. Delete the `pnpm.overrides` block from the root `package.json`.
2. Delete `vendor/`.
3. `pnpm install` (refreshes the lockfile against the registry versions).
4. Re-run the gates (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`).

Until then, any framework upgrade means re-packing the closure from the
solid-sdk checkout, replacing the tarballs, and re-installing.
