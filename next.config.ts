import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["plotly.js"],
  // Bundle local CSV samples into the serverless function traces when needed
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/**/*"],
  },
};

export default nextConfig;
