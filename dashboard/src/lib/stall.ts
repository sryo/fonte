// Why a downloading torrent stopped receiving data, from the tracker summary
// the daemon syncs and the session's listen-port check.
// Imports stay relative (no "@/") so the root vitest run can resolve them.

export interface StallInput {
  numPeers: number;
  swarmSeeders?: number;
  trackersReporting?: number;
  trackersTotal?: number;
}

export interface StallText {
  title: string;
  detail: string;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export function describeStall(t: StallInput, listenPort: { port: number | null; open: boolean | null } | null): StallText {
  const total = t.trackersTotal;
  const reporting = t.trackersReporting ?? 0;
  const seeders = t.swarmSeeders ?? 0;

  if (total === undefined) {
    return t.numPeers === 0
      ? { title: "Stalled — no peers available", detail: "This torrent isn't finding peers. Try updating trackers, or swap to a healthier release." }
      : { title: "Stalled — not receiving data", detail: "Peers are connected but nothing is arriving. Try updating trackers, or swap to a healthier release." };
  }
  if (total === 0) {
    return { title: "Stalled — no trackers", detail: "Peers can only come from DHT because this torrent carries no trackers. Swap to a healthier release." };
  }
  if (reporting === 0) {
    return { title: "Stalled — no tracker has answered", detail: `None of the ${count(total, "tracker")} has responded yet. Try updating trackers, or swap to a healthier release.` };
  }
  if (seeders === 0) {
    const detail = t.numPeers > 0
      ? `None of the ${count(reporting, "tracker")} that answered knows a seeder, and the ${count(t.numPeers, "connected peer")} have nothing you're missing. Swap to a healthier release.`
      : `None of the ${count(reporting, "tracker")} that answered knows a seeder. Swap to a healthier release.`;
    return { title: "Stalled — no seeders", detail };
  }
  if (t.numPeers === 0) {
    const detail = listenPort?.open === false
      ? `Your listening port${listenPort.port ? ` ${listenPort.port}` : ""} is closed, so peers behind their own router can't reach you. Forward it on the router, or swap to a release with more seeders.`
      : "Try updating trackers, or swap to a release with more seeders.";
    return { title: `Stalled — ${count(seeders, "seeder")} known, none reachable`, detail };
  }
  return {
    title: "Stalled — not receiving data",
    detail: `${count(t.numPeers, "peer")} connected and ${count(seeders, "seeder")} known, but nothing is arriving. Try updating trackers, or swap to a healthier release.`,
  };
}
