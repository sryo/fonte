"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { DotsThree } from "@phosphor-icons/react";
import {
  getTorrent, getTorrentFiles, pauseTorrent, resumeTorrent, removeTorrent,
  verifyTorrent, reannounceTorrent, searchTorrentAlternatives, swapTorrent,
  getTorrentSubtitles, fetchTorrentSubtitles,
  type TorrentRecord, type TorrentFileRecord, type SubtitleRecord, type AlternativeResult,
} from "@/lib/api";
import { formatBytes, formatSpeed } from "@/lib/format";
import { usePolling } from "@/hooks/usePolling";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Callout } from "@/components/ui/callout";
import { LoadingState, EmptyState } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProgressBar, toPct } from "@/components/ui/progress-bar";
import { DetailHero } from "@/components/shared/detail-hero";
import { FileList } from "@/components/torrent/file-list";
import { SubtitleList } from "@/components/torrent/subtitle-list";
import { AlternativesModal } from "@/components/torrent/alternatives-modal";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

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

  const runAction = useCallback(async (action: (id: string) => Promise<unknown>) => {
    setActionLoading(true);
    try {
      await action(id);
      await fetchData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActionLoading(false);
    }
  }, [id, fetchData]);

  const handlePause = useCallback(() => runAction(pauseTorrent), [runAction]);
  const handleResume = useCallback(() => runAction(resumeTorrent), [runAction]);
  const handleVerify = useCallback(() => runAction(verifyTorrent), [runAction]);
  const handleReannounce = useCallback(() => runAction(reannounceTorrent), [runAction]);

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

  const handleFetchSubtitles = useCallback(async () => {
    try {
      await fetchTorrentSubtitles(id);
      fetchData();
    } catch {}
  }, [id, fetchData]);

  if (loading) return <LoadingState label="Loading torrent…" />;

  if (!torrent) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-6">
        <EmptyState
          title="Torrent not found"
          hint={error || `No torrent with ID "${id}" exists.`}
          action={<Button variant="outline" size="sm" asChild><Link href="/">Back to Torrents</Link></Button>}
        />
      </div>
    );
  }

  const pct = toPct(torrent.progress);
  const isPaused = torrent.status === "paused";
  const isStalled = torrent.status === "downloading" && torrent.numPeers === 0;
  const canPauseResume = ["downloading", "seeding", "paused"].includes(torrent.status);

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6 animate-card-enter">
      <PageHeader
        backHref="/"
        actions={
          <>
            {canPauseResume && (
              <Button variant="outline" size="sm" onClick={isPaused ? handleResume : handlePause} disabled={actionLoading}>
                {isPaused ? "Resume" : "Pause"}
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-destructive" onClick={handleRemove} disabled={actionLoading}>Remove</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More actions"><DotsThree weight="bold" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleVerify} disabled={actionLoading}>Verify</DropdownMenuItem>
                <DropdownMenuItem onClick={handleReannounce} disabled={actionLoading}>Update trackers</DropdownMenuItem>
                <DropdownMenuItem onClick={handleFindAlternatives} disabled={altSearching}>Find alternatives</DropdownMenuItem>
                {torrent.magnetUri && (
                  <DropdownMenuItem onClick={() => navigator.clipboard.writeText(torrent.magnetUri!)}>
                    Copy magnet
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {(error || torrent.errorMessage) && <Callout tone="error">{torrent.errorMessage || error}</Callout>}

      {isStalled && (
        <Callout
          tone="warn"
          action={<Button size="xs" variant="ghost" onClick={handleFindAlternatives} disabled={altSearching}>{altSearching ? "Searching…" : "Find alternatives"}</Button>}
        >
          <p className="font-medium">Stalled &mdash; no peers available</p>
          <p className="text-xs opacity-80">This torrent isn&apos;t finding peers. Try updating trackers, or swap to a healthier release.</p>
        </Callout>
      )}

      <DetailHero
        posterUrl={torrent.posterUrl}
        title={torrent.name}
        badges={<><StatusBadge status={torrent.status} size="sm" /><span className="text-xs font-medium tabular-nums">{pct}%</span></>}
        meta={`↓ ${formatSpeed(torrent.downloadSpeed)} · ↑ ${formatSpeed(torrent.uploadSpeed)} · ${torrent.numPeers} peers · ${formatBytes(torrent.size)}`}
        details={
          <dl className="grid grid-cols-1 gap-2 font-mono text-2xs sm:grid-cols-2">
            <div><dt className="text-muted-foreground">Info Hash</dt><dd className="break-all">{torrent.infoHash}</dd></div>
            <div><dt className="text-muted-foreground">Save Path</dt><dd className="break-all">{torrent.savePath}</dd></div>
            <div><dt className="text-muted-foreground">Added</dt><dd>{formatDate(torrent.addedAt)}</dd></div>
            {torrent.completedAt && (
              <div><dt className="text-muted-foreground">Completed</dt><dd>{formatDate(torrent.completedAt)}</dd></div>
            )}
          </dl>
        }
      >
        <ProgressBar
          value={torrent.progress}
          variant="hero"
          shine={torrent.status === "downloading"}
          stalled={isStalled}
          done={torrent.status === "completed" || torrent.status === "seeding"}
          className="w-full"
          label={`Download progress: ${pct}%`}
        />
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatBytes(torrent.downloaded)} / {formatBytes(torrent.size)} · Uploaded {formatBytes(torrent.uploaded)}
        </p>
      </DetailHero>

      <Section title="Files" count={files.length}>
        <FileList torrentId={id} files={files} setFiles={setFiles} downloading={torrent.status === "downloading"} stalled={isStalled} />
      </Section>

      <Section
        title="Subtitles"
        count={subtitles.length}
        action={
          <Button size="sm" variant="secondary" onClick={handleFetchSubtitles} disabled={torrent.status === "adding" || torrent.status === "error"}>
            Fetch Subtitles
          </Button>
        }
      >
        <SubtitleList subtitles={subtitles} onChanged={fetchData} />
      </Section>

      <AlternativesModal
        open={showAlternatives}
        onClose={() => setShowAlternatives(false)}
        searching={altSearching}
        error={altError}
        results={alternatives}
        onSwap={handleSwap}
      />
    </div>
  );
}
