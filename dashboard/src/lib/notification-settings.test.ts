// Runs via root `npm test`; imports stay relative (nothing maps "@/" outside Next).
import { describe, it, expect } from "vitest";
import { notificationSettingsFromRaw } from "./notification-settings";

describe("notificationSettingsFromRaw", () => {
  it("shows the defaults the daemon uses when keys are unset", () => {
    expect(notificationSettingsFromRaw(undefined)).toEqual({
      enabled: false,
      torrent_completed: false,
      watchlist_match: false,
      automation_failed: true,
    });
  });

  it("keeps saved values", () => {
    expect(
      notificationSettingsFromRaw({ enabled: true, torrent_completed: true, automation_failed: false })
    ).toEqual({ enabled: true, torrent_completed: true, watchlist_match: false, automation_failed: false });
  });
});
