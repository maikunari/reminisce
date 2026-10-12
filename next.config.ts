import { withBotId } from "botid/next/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Next 16 writes an AGENTS.md into the repo on build unless told not to.
  agentRules: false,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Recorded Qloo fixtures are read from disk at request time in fixture mode.
  // Make sure they are traced into the serverless bundle on Vercel.
  outputFileTracingIncludes: {
    "/api/*": ["./fixtures/**/*"],
  },
};

// BotID (Basic) proxies its challenge script through this origin; see src/instrumentation-client.ts.
export default withBotId(nextConfig);
