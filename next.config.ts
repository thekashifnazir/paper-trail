import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // The engine reads the sample statement and the saved pass 3 runs from disk at request time
  // (lib/cash/data.ts, lib/cash/replay.ts). Ship them with the API functions so Live mode works on Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["./data/sample/*.json", "./data/sample/*.csv", "./results/*.json"],
  },
};

export default nextConfig;
