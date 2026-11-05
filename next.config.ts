import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The desktop package ships this server build inside the app bundle, so a user can
  // run TaCos entirely on their own machine without Node installed.
  output: "standalone",
  // Never trace the live SQLite file into a server bundle — it holds real accounts.
  outputFileTracingExcludes: { "*": ["./data/**"] },
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // A long imported reference table is one server action's payload when the editor
    // saves it; the 1 MB default would let it in through Import but not out again.
    // Keep this above MAX_DOC_CHARS in src/lib/pages.ts (1M characters ≈ 3 MB of UTF-8).
    serverActions: { bodySizeLimit: "8mb" },
  },
  // The dev badge ("N" in the corner) is Next's build indicator, not app UI.
  devIndicators: false,
  serverExternalPackages: ["better-sqlite3", "@tus/server", "@tus/file-store"],
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
