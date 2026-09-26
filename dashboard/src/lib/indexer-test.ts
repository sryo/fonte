import type { IndexerStatus } from "./api/torrents";

export function describeIndexerTest(res: IndexerStatus): { ok: boolean; text: string } {
  if (res.reason === "jackett-not-configured") {
    return { ok: false, text: "Add the Jackett URL and API key first" };
  }
  if (res.reason === "jackett-error") {
    return { ok: false, text: `Can't reach Jackett at ${res.jackettUrl ?? "the saved URL"}` };
  }
  if (res.countError) {
    return {
      ok: false,
      text: /^HTTP 4/.test(res.countError)
        ? `Jackett is up but rejected the API key (${res.countError})`
        : `Jackett is up but listing indexers failed. ${res.countError}`,
    };
  }
  if (res.count === 0) {
    return { ok: false, text: "Connected, but no indexers are set up in Jackett" };
  }
  return { ok: true, text: `Connected. ${res.count} indexer${res.count === 1 ? "" : "s"}` };
}

export function normalizeJackettUrl(url: string): string {
  if (!url || /^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  return `http://${url}`;
}
