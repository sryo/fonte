// Runs via root `npm test`; imports stay relative (nothing maps "@/" outside Next).
import { describe, it, expect, vi, beforeEach } from "vitest";

const getSettings = vi.fn();
vi.mock("./api", () => ({ getSettings: () => getSettings() }));

beforeEach(() => {
  vi.resetModules();
  getSettings.mockReset();
});

describe("getCachedSettings", () => {
  it("fetches once per page session", async () => {
    getSettings.mockResolvedValue({ watchlist: { preferred_quality: "720p" } });
    const { getCachedSettings } = await import("./settings-cache");
    await getCachedSettings();
    await getCachedSettings();
    expect(getSettings).toHaveBeenCalledTimes(1);
  });

  it("serves what the settings page just saved rather than the first fetch", async () => {
    getSettings.mockResolvedValue({ watchlist: { preferred_quality: "720p" } });
    const { getCachedSettings, primeCachedSettings } = await import("./settings-cache");
    await getCachedSettings();
    primeCachedSettings({ watchlist: { preferred_quality: "2160p" } });
    expect(await getCachedSettings()).toEqual({ watchlist: { preferred_quality: "2160p" } });
    expect(getSettings).toHaveBeenCalledTimes(1);
  });
});
