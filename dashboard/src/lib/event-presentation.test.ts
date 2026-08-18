import { describe, it, expect } from "vitest";
import { DEFAULT_EVENT_TYPES, type EventData } from "./api/events";
import { eventDetail, eventLabel, eventTone } from "./event-presentation";

const event = (type: string, data: Record<string, unknown> = {}): EventData => ({
  type,
  timestamp: 1_755_000_000_000,
  ...data,
});

describe("eventLabel", () => {
  it("gives every subscribed event type a human label", () => {
    for (const type of DEFAULT_EVENT_TYPES) {
      const label = eventLabel(type);
      expect(label).not.toContain(":");
      expect(label[0]).toBe(label[0].toUpperCase());
    }
  });

  it("falls back to a readable form for an unknown type", () => {
    expect(eventLabel("plugin:custom")).toBe("Plugin custom");
  });
});

describe("eventTone", () => {
  it("tones completions done, failures error, and stalls warn", () => {
    expect(eventTone("torrent:completed")).toBe("done");
    expect(eventTone("subtitle:error")).toBe("error");
    expect(eventTone("torrent:stalled")).toBe("warn");
    expect(eventTone("watchlist:search")).toBe("watch");
  });

  it("falls back to neutral for an unknown type", () => {
    expect(eventTone("plugin:custom")).toBe("neutral");
  });
});

describe("eventDetail", () => {
  it("names the torrent for lifecycle events", () => {
    expect(eventDetail(event("torrent:completed", { id: "t1", name: "Some.Release.1080p" })))
      .toBe("Some.Release.1080p");
  });

  it("falls back to the magnet display name, then the hash", () => {
    expect(eventDetail(event("torrent:added", {
      infoHash: "fedcba9876543210fedcba9876543210fedcba98",
      magnetUri: "magnet:?xt=urn:btih:fedcba98&dn=Show+S01E01+1080p",
    }))).toBe("Show S01E01 1080p");

    expect(eventDetail(event("torrent:added", {
      infoHash: "fedcba9876543210fedcba9876543210fedcba98",
    }))).toBe("fedcba98");
  });

  it("says whether removal trashed the files", () => {
    expect(eventDetail(event("torrent:removed", { name: "Old.Release", filesDeleted: true })))
      .toBe("Old.Release · files trashed");
    expect(eventDetail(event("torrent:removed", { name: "Old.Release", filesDeleted: false })))
      .toBe("Old.Release · files kept");
  });

  it("reports stall duration and peers", () => {
    expect(eventDetail(event("torrent:stalled", { name: "Slow.Release", minutesStalled: 7, numPeers: 0 })))
      .toBe("Slow.Release · 7m · 0 peers");
  });

  it("summarizes watchlist activity", () => {
    expect(eventDetail(event("watchlist:search", { title: "Futurama", resultCount: 98 })))
      .toBe("Futurama · 98 results");
    expect(eventDetail(event("watchlist:match", { title: "Futurama", torrentName: "Futurama.S14E04" })))
      .toBe("Futurama · Futurama.S14E04");
    expect(eventDetail(event("watchlist:results", { title: "Futurama", count: 3 })))
      .toBe("Futurama · 3 new");
  });

  it("summarizes messages and agent runs", () => {
    expect(eventDetail(event("message:incoming", {
      sender: "Mateo", channel: "whatsapp", message: "download futurama",
    }))).toBe("Mateo · [whatsapp] · download futurama");

    expect(eventDetail(event("agent:invoke", { agentId: "fonte", agentName: "Fonte Agent" })))
      .toBe("Fonte Agent");
  });

  it("returns an empty detail for payloads with nothing to show", () => {
    expect(eventDetail(event("message:done", {}))).toBe("");
    expect(eventDetail(event("whatsapp:ready", {}))).toBe("");
  });

  it("never leaks the WhatsApp QR payload", () => {
    expect(eventDetail(event("whatsapp:qr", { qr: "2@secretpairingstring" }))).toBe("");
  });

  it("renders a numeric disconnect code", () => {
    expect(eventDetail(event("whatsapp:disconnected", { reason: 401 }))).toBe("code 401");
  });

  it("shows subtitle language transitions and automation rules", () => {
    expect(eventDetail(event("subtitle:translated", { sourceLanguage: "en", targetLanguage: "es" })))
      .toBe("en → es");
    expect(eventDetail(event("automation:executed", {
      ruleName: "Organize downloads", triggerEvent: "torrent:completed",
    }))).toBe("Organize downloads · torrent:completed");
  });
});
