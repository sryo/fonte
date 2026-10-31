import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, defaultApiBase, displayApiBase, getApiBase } from "./client";

describe("defaultApiBase", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is the page's own origin, which proxies /api to the daemon", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);
    expect(defaultApiBase()).toBe("");
    expect(getApiBase()).toBe("");
  });

  it("prefers NEXT_PUBLIC_API_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://fonte.local:4000");
    expect(defaultApiBase()).toBe("http://fonte.local:4000");
    expect(getApiBase()).toBe("http://fonte.local:4000");
  });
});

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("calls a relative /api path by default", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("/api/status");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/status");
  });
});

describe("displayApiBase", () => {
  it("names the page origin when the base is same-origin", () => {
    expect(displayApiBase("", "http://fonte.localhost")).toBe("http://fonte.localhost");
  });

  it("shows an explicit base as is", () => {
    expect(displayApiBase("http://localhost:3777", "http://fonte.localhost")).toBe("http://localhost:3777");
  });
});
