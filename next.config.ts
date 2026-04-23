import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./src/server/db/migrations/**/*.sql"],
  },
  experimental: {
    typedRoutes: true,
  },
};

export default config;
