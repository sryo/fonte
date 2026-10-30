// Runs via root `npm test`; imports stay relative (nothing maps "@/" outside Next).
import { describe, it, expect } from "vitest";
import {
  destinationNote,
  notificationSettingsFromRaw,
  notificationSettingsPatch,
  testDestination,
  type NotificationForm,
} from "./notification-settings";
import { mergeSection } from "./settings-patch";

describe("notificationSettingsFromRaw", () => {
  it("shows the defaults the daemon uses when keys are unset", () => {
    expect(notificationSettingsFromRaw(undefined)).toEqual({
      enabled: false,
      torrent_completed: false,
      watchlist_match: false,
      automation_failed: true,
      torrent_completed_destination: "mac",
      watchlist_match_destination: "mac",
      automation_failed_destination: "mac",
    });
  });

  it("keeps saved values", () => {
    expect(
      notificationSettingsFromRaw({
        enabled: true,
        torrent_completed: true,
        automation_failed: false,
        destinations: { torrent_completed: "whatsapp", watchlist_match: "both" },
      })
    ).toEqual({
      enabled: true,
      torrent_completed: true,
      watchlist_match: false,
      automation_failed: false,
      torrent_completed_destination: "whatsapp",
      watchlist_match_destination: "both",
      automation_failed_destination: "mac",
    });
  });

  it("reads an unknown destination as the Mac, like the daemon", () => {
    expect(
      notificationSettingsFromRaw({ destinations: { torrent_completed: "pager" } }).torrent_completed_destination
    ).toBe("mac");
  });
});

describe("notificationSettingsPatch", () => {
  it("passes toggles through", () => {
    expect(notificationSettingsPatch({ enabled: true })).toEqual({ enabled: true });
  });

  it("nests a destination under destinations", () => {
    expect(notificationSettingsPatch({ watchlist_match_destination: "both" })).toEqual({
      destinations: { watchlist_match: "both" },
    });
  });

  it("keeps sibling destinations once merged into the saved section", () => {
    const saved = { enabled: true, destinations: { torrent_completed: "whatsapp" } };
    expect(mergeSection(saved, notificationSettingsPatch({ automation_failed_destination: "both" }))).toEqual({
      enabled: true,
      destinations: { torrent_completed: "whatsapp", automation_failed: "both" },
    });
  });
});

describe("destinationNote", () => {
  const ready = { linked: true, allowedChat: "1@c.us" };

  it("says nothing for the Mac or a ready WhatsApp", () => {
    expect(destinationNote("mac", { linked: false, allowedChat: null })).toBeNull();
    expect(destinationNote("whatsapp", ready)).toBeNull();
    expect(destinationNote("both", ready)).toBeNull();
  });

  it("explains the Mac fallback when no chat is picked", () => {
    expect(destinationNote("whatsapp", { linked: true, allowedChat: null })).toBe(
      "No WhatsApp chat picked. Sending to the Mac for now."
    );
  });

  it("explains that messages wait while WhatsApp is unlinked", () => {
    expect(destinationNote("both", { linked: false, allowedChat: "1@c.us" })).toBe(
      "WhatsApp isn't linked. Messages wait until it is."
    );
  });

  it("puts the missing chat first when both are missing", () => {
    expect(destinationNote("whatsapp", { linked: false, allowedChat: null })).toBe(
      "No WhatsApp chat picked. Sending to the Mac for now."
    );
  });
});

describe("testDestination", () => {
  const form = (patch: Partial<NotificationForm> = {}) => {
    const f = { ...notificationSettingsFromRaw({ enabled: true }), ...patch };
    return <K extends keyof NotificationForm>(key: K) => f[key];
  };

  it("tests the Mac when nothing routes elsewhere", () => {
    expect(testDestination(form())).toBe("mac");
  });

  it("tests WhatsApp when every enabled event goes there", () => {
    expect(testDestination(form({ torrent_completed: true, torrent_completed_destination: "whatsapp", automation_failed: false }))).toBe("whatsapp");
  });

  it("tests both when enabled events use different destinations", () => {
    expect(testDestination(form({ torrent_completed: true, torrent_completed_destination: "whatsapp" }))).toBe("both");
  });

  it("ignores the destination of events that are off", () => {
    expect(testDestination(form({ watchlist_match: false, watchlist_match_destination: "whatsapp" }))).toBe("mac");
  });
});
