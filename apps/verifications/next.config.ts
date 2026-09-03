import type { NextConfig } from "next";

/**
 * Zone app: served under the shell's rewrite prefix, so the basePath matches the
 * registry `path` for this app in apps/tour/content/walkthrough.json.
 */
const nextConfig: NextConfig = {
  basePath: "/verifications",
  async redirects() {
    return [
      {
        source: "/",
        destination: "/verifications",
        permanent: false,
        basePath: false,
      },
    ];
  },
};

export default nextConfig;
