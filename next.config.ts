import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desktop package ships this server build inside the app bundle, so a user can
  // run Tacos entirely on their own machine without Node installed.
  output: "standalone",
  // Never trace the live SQLite file into a server bundle — it holds real accounts.
  outputFileTracingExcludes: { "*": ["./data/**"] },
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
