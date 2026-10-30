import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    FONTE_API_PORT: process.env.FONTE_API_PORT ?? "",
  },
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
