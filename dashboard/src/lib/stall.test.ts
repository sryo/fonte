import { describe, it, expect } from "vitest";
import { describeStall } from "./stall";

const closed = { port: 51413, open: false };

describe("describeStall", () => {
  it("falls back to the peer count before the first tracker sync", () => {
    expect(describeStall({ numPeers: 0 }, null).title).toBe("Stalled — no peers available");
    expect(describeStall({ numPeers: 3 }, null).title).toBe("Stalled — not receiving data");
  });

  it("calls out a dead swarm when trackers answered with no seeders", () => {
    const text = describeStall({ numPeers: 4, swarmSeeders: 0, trackersReporting: 12, trackersTotal: 14 }, closed);
    expect(text.title).toBe("Stalled — no seeders");
    expect(text.detail).toContain("12 trackers that answered");
    expect(text.detail).toContain("4 connected peers have nothing");
  });

  it("names the closed port when seeders exist but none connect", () => {
    const text = describeStall({ numPeers: 0, swarmSeeders: 2, trackersReporting: 6, trackersTotal: 24 }, closed);
    expect(text.title).toBe("Stalled — 2 seeders known, none reachable");
    expect(text.detail).toContain("port 51413 is closed");
  });

  it("does not blame the port when it is open or unknown", () => {
    const open = describeStall({ numPeers: 0, swarmSeeders: 1, trackersReporting: 1, trackersTotal: 1 }, { port: 51413, open: true });
    expect(open.title).toBe("Stalled — 1 seeder known, none reachable");
    expect(open.detail).not.toContain("closed");
    expect(describeStall({ numPeers: 0, swarmSeeders: 1, trackersReporting: 1, trackersTotal: 1 }, null).detail).not.toContain("closed");
  });

  it("distinguishes silent trackers from a trackerless magnet", () => {
    expect(describeStall({ numPeers: 0, trackersReporting: 0, trackersTotal: 5 }, closed).title).toBe("Stalled — no tracker has answered");
    expect(describeStall({ numPeers: 0, trackersReporting: 0, trackersTotal: 0 }, closed).title).toBe("Stalled — no trackers");
  });

  it("keeps the generic wording when peers and seeders both exist", () => {
    const text = describeStall({ numPeers: 3, swarmSeeders: 5, trackersReporting: 2, trackersTotal: 2 }, closed);
    expect(text.title).toBe("Stalled — not receiving data");
    expect(text.detail).toContain("3 peers connected and 5 seeders known");
  });
});
