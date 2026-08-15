import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@sales-platform/contracts", "@sales-platform/config"],
};

export default nextConfig;
