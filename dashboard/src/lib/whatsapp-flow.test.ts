// Runs via root `npm test`; imports stay relative (nothing maps "@/" outside Next).
import { describe, it, expect } from "vitest";
import {
  whatsAppPanel,
  disconnectMessage,
  startingLabel,
  chatOptions,
  keepPairingCode,
  parseWhatsAppStatus,
} from "./whatsapp-flow";

describe("whatsAppPanel", () => {
  it("shows one panel per state instead of stacking the spinner over the phone form", () => {
    expect(whatsAppPanel({ status: "connecting", linked: false, pairing: true })).toBe("pairing");
    expect(whatsAppPanel({ status: "waiting_qr", linked: false, pairing: true })).toBe("pairing");
    expect(whatsAppPanel({ status: "disconnected", linked: false, pairing: true })).toBe("pairing");
  });

  it("maps each service status to its panel", () => {
    expect(whatsAppPanel({ status: "disconnected", linked: false, pairing: false })).toBe("link");
    expect(whatsAppPanel({ status: "connecting", linked: false, pairing: false })).toBe("starting");
    expect(whatsAppPanel({ status: "waiting_qr", linked: false, pairing: false })).toBe("qr");
    expect(whatsAppPanel({ status: "connected", linked: true, pairing: true })).toBe("connected");
  });

  it("offers a reconnect instead of a fresh link when the session was only paused", () => {
    expect(whatsAppPanel({ status: "disconnected", linked: true, pairing: false })).toBe("paused");
  });
});

describe("disconnectMessage", () => {
  it("explains why the device needs linking again", () => {
    expect(disconnectMessage("logged_out")).toMatch(/unlinked this device/i);
    expect(disconnectMessage("qr_expired")).toMatch(/expired/i);
    expect(disconnectMessage("replaced")).toMatch(/another/i);
    expect(disconnectMessage("connection_failed")).toMatch(/couldn't reach/i);
  });

  it("says nothing without a reason", () => {
    expect(disconnectMessage(undefined)).toBeNull();
  });

  it("keeps UI prose free of em dashes", () => {
    for (const r of ["logged_out", "qr_expired", "replaced", "connection_failed"] as const) {
      expect(disconnectMessage(r)).not.toContain("—");
    }
  });
});

describe("startingLabel", () => {
  it("tells a reconnect apart from a first link", () => {
    expect(startingLabel(true)).toMatch(/reconnecting/i);
    expect(startingLabel(false)).toMatch(/starting/i);
  });
});

describe("keepPairingCode", () => {
  it("drops a shown code once the service gives up, since it can no longer be used", () => {
    expect(keepPairingCode("ABCD1234", "disconnected")).toBeNull();
  });

  it("keeps the code while the service is waiting for the phone", () => {
    expect(keepPairingCode("ABCD1234", "waiting_qr")).toBe("ABCD1234");
    expect(keepPairingCode("ABCD1234", "connecting")).toBe("ABCD1234");
  });
});

describe("chatOptions", () => {
  const chats = [
    { id: "me@s.whatsapp.net", name: "Message Yourself", isGroup: false, unread: 0 },
    { id: "1@g.us", name: "Movies", isGroup: true, unread: 0 },
  ];

  it("lists the chats as they are", () => {
    expect(chatOptions(chats, "1@g.us")).toEqual(chats);
  });

  it("keeps a saved chat selectable when it is missing from the fetched list", () => {
    const options = chatOptions([], "2@g.us");
    expect(options).toEqual([{ id: "2@g.us", name: "Saved chat (not found)", isGroup: true, unread: 0 }]);
  });

  it("adds nothing when no chat is saved", () => {
    expect(chatOptions(chats, null)).toEqual(chats);
  });
});

describe("parseWhatsAppStatus", () => {
  it("reads a full status payload", () => {
    expect(parseWhatsAppStatus({ ok: true, status: "waiting_qr", linked: false, qr: "ref" }))
      .toEqual({ status: "waiting_qr", linked: false, qr: "ref", reason: undefined });
  });

  it("falls back to disconnected for an unknown status and ignores unknown reasons", () => {
    expect(parseWhatsAppStatus({ ok: true, status: "weird", reason: "nope" }))
      .toEqual({ status: "disconnected", linked: false, qr: undefined, reason: undefined });
  });
});
