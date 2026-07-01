"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getTorrent,
  getTorrentFiles,
  setTorrentFilesWanted,
  pauseTorrent,
  resumeTorrent,
  removeTorrent,
  verifyTorrent,
  reannounceTorrent,
  searchTorrentAlternatives,
  swapTorrent,
  getTorrentSubtitles,
  fetchTorrentSubtitles,
  translateSubtitleApi,
  type TorrentRecord,
  type TorrentFileRecord,
  type SubtitleRecord,
  type AlternativeResult,
} from "@/lib/api";
import { formatBytes, formatSpeed } from "@/lib/format";
import { ProgressBar, toPct } from "@/components/ui/progress-bar";
import { usePolling } from "@/hooks/usePolling";

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function statusColor(status: TorrentRecord["status"]): string {
  switch (status) {
    case "downloading":
      return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    case "seeding":
      return "bg-green-500/15 text-green-400 border-green-500/30";
    case "completed":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "paused":
      return "bg-yellow-500/15 text-yellow-400 border-yellow-500/30";
    case "error":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "checking":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "adding":
      return "bg-purple-500/15 text-purple-400 border-purple-500/30";
    case "removed":
      return "bg-neutral-500/15 text-neutral-400 border-neutral-500/30";
    default:
      return "bg-neutral-500/15 text-neutral-400 border-neutral-500/30";
  }
}

function qualityMatchColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 50) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

// ── Component ────────────────────────────────────────────────────────────

export default function TorrentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [torrent, setTorrent] = useState<TorrentRecord | null>(null);
  const [files, setFiles] = useState<TorrentFileRecord[]>([]);
  const [subtitles, setSubtitles] = useState<SubtitleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [alternatives, setAlternatives] = useState<AlternativeResult[]>([]);
  const [altSearching, setAltSearching] = useState(false);
  const [altError, setAltError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [torrentRes, filesRes, subsRes] = await Promise.all([
        getTorrent(id),
        getTorrentFiles(id),
        getTorrentSubtitles(id).catch(() => ({ ok: false, subtitles: [] })),
      ]);
      setTorrent(torrentRes.torrent);
      setFiles(filesRes.files);
      setSubtitles(subsRes.subtitles || []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  usePolling(fetchData, 2000);

  const handlePause = useCallback(async () => {
    setActionLoading(true);
    try {
      await pauseTorrent(id);
      await fetchData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [id, fetchData]);

  const handleResume = useCallback(async () => {
    setActionLoading(true);
    try {
      await resumeTorrent(id);
      await fetchData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [id, fetchData]);

  const handleVerify = useCallback(async () => {
    setActionLoading(true);
    try {
      await verifyTorrent(id);
      await fetchData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [id, fetchData]);

  const handleReannounce = useCallback(async () => {
    setActionLoading(true);
    try {
      await reannounceTorrent(id);
      await fetchData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [id, fetchData]);

  const handleRemove = useCallback(async () => {
    if (!confirm("Remove this torrent? Downloaded files will be kept.")) return;
    setActionLoading(true);
    try {
      await removeTorrent(id);
      router.push("/");
    } catch (err) {
      setError((err as Error).message);
      setActionLoading(false);
    }
  }, [id, router]);

  const handleFindAlternatives = useCallback(async () => {
    setShowAlternatives(true);
    setAltSearching(true);
    setAltError(null);
    try {
      const res = await searchTorrentAlternatives(id);
      setAlternatives(res.results);
    } catch (err) {
      setAltError((err as Error).message);
    } finally {
      setAltSearching(false);
    }
  }, [id]);

  const handleSwap = useCallback(async (magnetUri: string) => {
    if (!confirm("Swap in this release? The current torrent and its partial files will be removed.")) return;
    setActionLoading(true);
    try {
      const res = await swapTorrent(id, magnetUri);
      router.push(`/torrents/${res.torrent.id}`);
    } catch (err) {
      setAltError((err as Error).message);
      setActionLoading(false);
    }
  }, [id, router]);

  // ── Loading state ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading torrent...
        </div>
      </div>
    );
  }

  // ── Not found / error state ──────────────────────────────────────────

  if (!torrent) {
    return (
      <div className="p-8">
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-lg font-medium">Torrent not found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {error || `No torrent with ID "${id}" exists.`}
          </p>
          <Link href="/">
            <button className="mt-4 inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">
              Back to Torrents
            </button>
          </Link>
        </div>
      </div>
    );
  }

  const pct = toPct(torrent.progress);
  const isPaused = torrent.status === "paused";
  const isStalled = torrent.status === "downloading" && torrent.numPeers === 0;
  const canPauseResume =
    torrent.status === "downloading" ||
    torrent.status === "seeding" ||
    torrent.status === "paused";

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6 animate-card-enter">
      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5L8.25 12l7.5-7.5"
              />
            </svg>
          </Link>
          <div>
            <h1 className="text-base font-semibold">{torrent.name}</h1>
            <p className="text-xs text-muted-foreground font-mono">
              {torrent.infoHash}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {canPauseResume && (
            <button
              onClick={isPaused ? handleResume : handlePause}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent transition-colors disabled:opacity-50"
            >
              {isPaused ? "Resume" : "Pause"}
            </button>
          )}
          <button
            onClick={handleRemove}
            disabled={actionLoading}
            className="inline-flex items-center gap-2 rounded-md border border-red-500/30 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}

        {/* Error banner */}
        {(error || torrent.errorMessage) && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {torrent.errorMessage || error}
          </div>
        )}

        {/* Stall banner */}
        {isStalled && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Stalled — no peers available</p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">This torrent isn&apos;t finding peers. Try updating trackers, or swap to a healthier release.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={handleReannounce} disabled={actionLoading} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50">Update trackers</button>
              <button onClick={handleFindAlternatives} disabled={altSearching} className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 transition-colors disabled:opacity-50">{altSearching ? "Searching…" : "Find alternatives"}</button>
            </div>
          </div>
        )}

        {/* ── Progress section ───────────────────────────────────────── */}
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${statusColor(torrent.status)}`}
            >
              {torrent.status}
            </span>
            <span className="text-sm font-medium tabular-nums">{pct}%</span>
          </div>
          {/* Progress bar */}
          <ProgressBar
            value={torrent.progress}
            variant="hero"
            shine={torrent.status === "downloading"}
            stalled={isStalled}
            done={torrent.status === "completed" || torrent.status === "seeding"}
            className="w-full"
            label={`Download progress: ${pct}%`}
          />
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {formatBytes(torrent.downloaded)} / {formatBytes(torrent.size)}
            </span>
            <span>Uploaded: {formatBytes(torrent.uploaded)}</span>
          </div>
          <div className="mt-4 pt-3 border-t flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground mr-1">Maintenance</span>
            <button onClick={handleVerify} disabled={actionLoading} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50">Verify</button>
            <button onClick={handleReannounce} disabled={actionLoading} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50">Update trackers</button>
          </div>
        </div>

        {/* ── Stats grid ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Download Speed" value={formatSpeed(torrent.downloadSpeed)} />
          <StatCard label="Upload Speed" value={formatSpeed(torrent.uploadSpeed)} />
          <StatCard label="Peers" value={String(torrent.numPeers)} />
          <StatCard
            label="Size"
            value={formatBytes(torrent.size)}
          />
        </div>

        {/* ── Details ────────────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">Details</h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
            <DetailRow label="Info Hash" value={torrent.infoHash} mono />
            <DetailRow label="Save Path" value={torrent.savePath} mono />
            <DetailRow label="Added" value={formatDate(torrent.addedAt)} />
            {torrent.completedAt && (
              <DetailRow
                label="Completed"
                value={formatDate(torrent.completedAt)}
              />
            )}
            <DetailRow
              label="Downloaded"
              value={formatBytes(torrent.downloaded)}
            />
            <DetailRow
              label="Uploaded"
              value={formatBytes(torrent.uploaded)}
            />
          </dl>
        </div>

        {/* ── File list ──────────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card p-5">
          <h2 className="text-sm font-semibold mb-4">
            Files ({files.length})
          </h2>
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No file information available yet.
            </p>
          ) : (
            <div className="space-y-2">
              {files.map((file, idx) => {
                const filePct = toPct(file.progress);
                const onToggle = async () => {
                  // Optimistic flip
                  setFiles((prev) =>
                    prev.map((f, i) => (i === idx ? { ...f, selected: !f.selected } : f)),
                  );
                  try {
                    const res = await setTorrentFilesWanted(
                      id,
                      file.selected ? [] : [idx],
                      file.selected ? [idx] : [],
                    );
                    if (res.ok && res.files) setFiles(res.files);
                  } catch {
                    // Revert on failure
                    setFiles((prev) =>
                      prev.map((f, i) => (i === idx ? { ...f, selected: file.selected } : f)),
                    );
                  }
                };
                return (
                  <div
                    key={idx}
                    className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm transition-opacity ${file.selected ? "" : "opacity-50"}`}
                  >
                    <input
                      type="checkbox"
                      checked={file.selected}
                      onChange={onToggle}
                      title={file.selected ? "Skip this file" : "Download this file"}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate font-mono text-xs ${file.selected ? "" : "line-through"}`}>
                        {file.name}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <ProgressBar
                          value={file.progress}
                          variant="list"
                          shine={torrent.status === "downloading" && file.selected && file.progress < 1}
                          stalled={isStalled}
                          done={file.progress >= 1}
                          className="flex-1"
                          label={`${file.name}: ${filePct}%`}
                        />
                        <span className="text-[11px] tabular-nums text-muted-foreground w-9 text-right">
                          {filePct}%
                        </span>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatBytes(file.size)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Subtitles ────────────────────────────────────────────── */}
        <div className="rounded-lg border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold">
              Subtitles ({subtitles.length})
            </h2>
            <button
              onClick={async () => {
                try {
                  await fetchTorrentSubtitles(id);
                  fetchData();
                } catch {}
              }}
              disabled={torrent.status === "adding" || torrent.status === "error"}
              className="px-3 py-1 text-xs bg-foreground text-background rounded hover:opacity-90 disabled:opacity-40"
            >
              Fetch Subtitles
            </button>
          </div>
          {subtitles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No subtitles yet. Fetch to search by title — you don&apos;t have to wait for the download.
            </p>
          ) : (
            <div className="space-y-2">
              {subtitles.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-xs uppercase font-bold w-6">{sub.language}</span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] rounded border ${
                      sub.status === "translated" || sub.status === "downloaded"
                        ? "bg-green-500/15 text-green-400 border-green-500/30"
                        : sub.status === "translating" || sub.status === "downloading"
                          ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                          : sub.status === "error"
                            ? "bg-red-500/15 text-red-400 border-red-500/30"
                            : "bg-neutral-500/15 text-neutral-400 border-neutral-500/30"
                    }`}>
                      {sub.status}
                    </span>
                    {sub.isOriginal && (
                      <span className="text-[10px] text-muted-foreground">(original)</span>
                    )}
                  </div>
                  {sub.isOriginal && sub.status === "downloaded" && (
                    <button
                      onClick={async () => {
                        const lang = prompt("Translate to language code (e.g. en, es, fr):");
                        if (lang) {
                          await translateSubtitleApi(sub.id, lang);
                          fetchData();
                        }
                      }}
                      className="text-xs text-primary hover:underline"
                    >
                      Translate
                    </button>
                  )}
                  {sub.errorMessage && (
                    <span className="text-[10px] text-red-400 truncate max-w-48">{sub.errorMessage}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Alternatives modal ─────────────────────────────────────── */}
        {showAlternatives && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setShowAlternatives(false)}>
            <div className="bg-card rounded-xl shadow-lg border p-6 w-full max-w-3xl space-y-4 animate-card-enter" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-base font-bold">Find alternatives</h3>
              {altError && <p className="text-xs text-destructive">{altError}</p>}
              {altSearching ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Searching indexers…
                </div>
              ) : alternatives.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">No alternatives found.</p>
              ) : (
                <div className="overflow-x-auto max-h-[60vh]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Title</th>
                        <th className="px-3 py-2 font-medium">Seeders</th>
                        <th className="px-3 py-2 font-medium">Size</th>
                        <th className="px-3 py-2 font-medium">Quality</th>
                        <th className="px-3 py-2 font-medium">Indexer</th>
                        <th className="px-3 py-2 font-medium text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alternatives.map((result, idx) => (
                        <tr key={idx} className="border-b last:border-b-0 hover:bg-muted/50 transition-colors">
                          <td className="px-3 py-2">
                            <p className="font-medium truncate max-w-xs" title={result.title}>{result.title}</p>
                          </td>
                          <td className="px-3 py-2">
                            <span className="text-green-600 dark:text-green-400">{result.seeders}</span>
                            <span className="text-muted-foreground mx-1">/</span>
                            <span className="text-red-600 dark:text-red-400">{result.leechers}</span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{formatBytes(result.size)}</td>
                          <td className="px-3 py-2">
                            <span className={`font-medium ${qualityMatchColor(result.qualityMatch)}`}>{result.qualityMatch}%</span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{result.indexer || "-"}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => handleSwap(result.magnetUri)}
                              disabled={actionLoading}
                              className="bg-primary text-primary-foreground rounded px-3 py-1 text-xs hover:opacity-90 disabled:opacity-50"
                            >
                              Swap in
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-end pt-1">
                <button
                  onClick={() => setShowAlternatives(false)}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`text-sm break-all ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
