import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultApiBase, getApiBase } from "./client";

describe("defaultApiBase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is localhost:3777 when FONTE_API_PORT is unset", () => {
    vi.stubEnv("FONTE_API_PORT", undefined);
    vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);
    expect(defaultApiBase()).toBe("http://localhost:3777");
    expect(getApiBase()).toBe("http://localhost:3777");
  });

  it("follows FONTE_API_PORT", () => {
    vi.stubEnv("FONTE_API_PORT", "3901");
    vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);
    expect(defaultApiBase()).toBe("http://localhost:3901");
    expect(getApiBase()).toBe("http://localhost:3901");
  });

  it("prefers NEXT_PUBLIC_API_URL over the port", () => {
    vi.stubEnv("FONTE_API_PORT", "3901");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://fonte.local:4000");
    expect(defaultApiBase()).toBe("http://fonte.local:4000");
    expect(getApiBase()).toBe("http://fonte.local:4000");
  });
});
