import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const port = process.env.FONTE_API_PORT || "3777";
    return [{ source: "/api/:path*", destination: `http://127.0.0.1:${port}/api/:path*` }];
  },
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
