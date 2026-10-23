import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    agentUpgrade: "security",
  },
  // The localtunnel hostname is dynamic, so allow its subdomains when this
  // local prototype is shared through a public development tunnel. Production
  // builds do not need this setting, but it keeps the dev client hydrated over
  // the public origin instead of blocking its dev-only resources.
  allowedDevOrigins: ["*.loca.lt"],
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
