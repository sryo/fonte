import type {
  TorrentStatus, TorrentRecord, TorrentFileRecord, TorrentConfig, TorrentStats,
  SubtitleRecord,
} from "../api-types";
import { apiFetch } from "./client";

// ── Torrents ─────────────────────────────────────────────────────────────

export async function getTorrents(status?: TorrentStatus): Promise<{ ok: boolean; torrents: TorrentRecord[] }> {
  const params = status ? `?status=${status}` : "";
  return apiFetch(`/api/torrents${params}`);
}

export interface IndexerStatus {
  ok: boolean;
  count: number;
  configured: boolean;
  jackettUrl?: string;
  reason?: string;
}

export async function getIndexerStatus(): Promise<IndexerStatus> {
  return apiFetch(`/api/indexers/status`);
}

export async function getTorrent(id: string): Promise<{ ok: boolean; torrent: TorrentRecord }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}`);
}

export async function addTorrent(data: { magnetUri?: string; infoHash?: string; metainfo?: string }): Promise<{ ok: boolean; torrent: TorrentRecord }> {
  return apiFetch("/api/torrents", { method: "POST", body: JSON.stringify(data) });
}

export async function pauseTorrent(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}/pause`, { method: "POST" });
}

export async function resumeTorrent(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}/resume`, { method: "POST" });
}

export async function removeTorrent(id: string, deleteFiles = false): Promise<{ ok: boolean }> {
  const params = deleteFiles ? "?deleteFiles=true" : "";
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}${params}`, { method: "DELETE" });
}

export async function verifyTorrent(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}/verify`, { method: "POST" });
}

export async function reannounceTorrent(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}/reannounce`, { method: "POST" });
}

export interface AlternativeResult {
  title: string;
  magnetUri: string;
  seeders: number;
  leechers: number;
  size: number;
  indexer?: string;
  publishDate?: number;
  qualityMatch: number;
}

export async function searchTorrentAlternatives(id: string): Promise<{ ok: boolean; results: AlternativeResult[] }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}/alternatives`, { method: "POST" });
}

export async function swapTorrent(id: string, magnetUri: string): Promise<{ ok: boolean; torrent: TorrentRecord }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}/swap`, { method: "POST", body: JSON.stringify({ magnetUri }) });
}

export async function getTorrentFiles(id: string): Promise<{ ok: boolean; files: TorrentFileRecord[] }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}/files`);
}

export async function setTorrentFilesWanted(
  id: string,
  wanted: number[],
  unwanted: number[],
): Promise<{ ok: boolean; files: TorrentFileRecord[] }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(id)}/files/wanted`, {
    method: "POST",
    body: JSON.stringify({ wanted, unwanted }),
  });
}

export async function getTorrentStats(): Promise<{ ok: boolean } & TorrentStats> {
  return apiFetch("/api/torrents/stats");
}

export async function getTorrentConfig(): Promise<{ ok: boolean; config: TorrentConfig }> {
  return apiFetch("/api/torrents/config");
}

export async function updateTorrentConfig(config: Partial<TorrentConfig>): Promise<{ ok: boolean; config: TorrentConfig }> {
  return apiFetch("/api/torrents/config", { method: "PUT", body: JSON.stringify(config) });
}

// ── Subtitles ────────────────────────────────────────────────────────────

export async function getTorrentSubtitles(torrentId: string): Promise<{ ok: boolean; subtitles: SubtitleRecord[] }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(torrentId)}/subtitles`);
}

export async function fetchTorrentSubtitles(torrentId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/torrents/${encodeURIComponent(torrentId)}/subtitles/fetch`, { method: "POST" });
}

export async function translateSubtitleApi(subtitleId: number, language: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/subtitles/${subtitleId}/translate`, { method: "POST", body: JSON.stringify({ language }) });
}

export async function deleteSubtitleApi(subtitleId: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/subtitles/${subtitleId}`, { method: "DELETE" });
}
