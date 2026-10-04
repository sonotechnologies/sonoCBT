import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A separate build folder for end-to-end runs and test builds, so they never clash with `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Embedded Postgres for local development ships WASM; keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
  // A stray lockfile in the home folder would otherwise be picked as the workspace root.
  turbopack: { root: __dirname },
  experimental: {
    // Crest uploads (≤1 MB) and student lists (CSV/Excel) go through server actions.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
