import { afterEach, describe, expect, it, vi } from "vitest";

async function rewrites() {
  vi.resetModules();
  const config = (await import("./next.config")).default;
  return config.rewrites!();
}

describe("next.config rewrites", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("proxies /api to the daemon on loopback", async () => {
    vi.stubEnv("FONTE_API_PORT", "");
    expect(await rewrites()).toEqual([
      { source: "/api/:path*", destination: "http://127.0.0.1:3777/api/:path*" },
    ]);
  });

  it("follows FONTE_API_PORT", async () => {
    vi.stubEnv("FONTE_API_PORT", "3901");
    expect(await rewrites()).toEqual([
      { source: "/api/:path*", destination: "http://127.0.0.1:3901/api/:path*" },
    ]);
  });
});
