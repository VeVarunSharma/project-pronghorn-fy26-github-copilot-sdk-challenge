import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@github/copilot-sdk",
    "@github/copilot",
  ],
};

export default nextConfig;
