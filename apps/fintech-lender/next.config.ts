import type { NextConfig } from "next";

/**
 * Zone app: served under the shell's rewrite prefix, so the basePath matches the
 * registry `path` for this app in apps/tour/content/walkthrough.json.
 *
 * `@aztec/bb.js` and `@noir-lang/*` (the UltraHonk + ACVM WASM toolchain
 * behind `@lending/vc-kit`'s ZK pre-qual proving,
 * `packages/vc-kit/src/zk/backend.ts`) each resolve their own `.wasm`/
 * `.wasm.gz` asset at runtime relative to their own package directory
 * (wasm-bindgen's `new URL('...wasm', import.meta.url)` + `fetch()`
 * pattern). Turbopack's route-handler bundling rewrites those lookups onto
 * a synthetic trace root, breaking the relative path each package uses to
 * reach its own binary next to the JS that requests it (real ENOENT
 * observed against a mangled `/ROOT/...` bb.js path, and a Node `fetch`
 * "file:" scheme failure for noir_js's ACVM wasm, both in dev).
 * `serverExternalPackages` excludes them from bundling/tracing so they're
 * `require`d normally out of `node_modules` instead, where each asset sits
 * exactly where its own code expects it.
 */
const nextConfig: NextConfig = {
  basePath: "/fintech-lender",
  async redirects() {
    return [
      {
        source: "/",
        destination: "/fintech-lender",
        permanent: false,
        basePath: false,
      },
    ];
  },
  serverExternalPackages: [
    "@aztec/bb.js",
    "@noir-lang/noir_js",
    "@noir-lang/acvm_js",
    "@noir-lang/noirc_abi",
  ],
};

export default nextConfig;
