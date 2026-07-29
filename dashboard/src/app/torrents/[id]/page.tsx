"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { DotsThree, X } from "@phosphor-icons/react";
import {
  getTorrent, getTorrentFiles, pauseTorrent, resumeTorrent, removeTorrent,
  verifyTorrent, reannounceTorrent, searchTorrentAlternatives, swapTorrent,
  getTorrentSubtitles, fetchTorrentSubtitles, setTorrentFilesWanted,
  type TorrentRecord, type TorrentFileRecord, type SubtitleRecord, type AlternativeResult,
} from "@/lib/api";
import { formatBytes, formatSpeed } from "@/lib/format";
import { usePollingEffect } from "@/lib/hooks";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Callout } from "@/components/ui/callout";
import { LoadingState, EmptyState } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProgressBar, toPct } from "@/components/ui/progress-bar";
import { DetailHero } from "@/components/shared/detail-hero";
import { FileList, type FileSelectionSummary } from "@/components/torrent/file-list";
import { SubtitleList } from "@/components/torrent/subtitle-list";
import { AlternativesModal } from "@/components/torrent/alternatives-modal";
import { RemoveTorrentDialog } from "@/components/torrent/remove-torrent-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

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
  const [showRemove, setShowRemove] = useState(false);
  const [swapTarget, setSwapTarget] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<AlternativeResult[]>([]);
  const [altSearching, setAltSearching] = useState(false);
  const [altError, setAltError] = useState<string | null>(null);
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [fileSelection, setFileSelection] = useState<FileSelectionSummary | null>(null);

  // Wanted-toggles still in flight, by file index. Poll responses overlay
  // these so a fetch that started before the toggle can't bounce the checkbox
  // back to its pre-toggle state.
  const pendingFileToggles = useRef(new Map<number, boolean>());
  const overlayPendingToggles = useCallback((serverFiles: TorrentFileRecord[]) => {
    const pending = pendingFileToggles.current;
    if (pending.size === 0) return serverFiles;
    return serverFiles.map((f, i) => (pending.has(i) ? { ...f, selected: pending.get(i)! } : f));
  }, []);

  const filesRef = useRef<TorrentFileRecord[]>([]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  // Held true by FileList during a rubber-band drag so a poll can't reshuffle
  // row geometry mid-selection.
  const filePollPausedRef = useRef(false);

  const fetchData = useCallback(async () => {
    try {
      const [torrentRes, filesRes, subsRes] = await Promise.all([
        getTorrent(id),
        getTorrentFiles(id),
        getTorrentSubtitles(id).catch(() => ({ ok: false, subtitles: [] })),
      ]);
      setTorrent(torrentRes.torrent);
      if (!filePollPausedRef.current) setFiles(overlayPendingToggles(filesRes.files));
      setSubtitles(subsRes.subtitles || []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, overlayPendingToggles]);

  usePollingEffect(fetchData, 2000);

  const handleSetWanted = useCallback(async (indices: number[], wanted: boolean) => {
    if (indices.length === 0) return;
    const idxSet = new Set(indices);
    // Exact per-index prior states, so a mixed batch reverts correctly.
    const prior = new Map(indices.map((i) => [i, filesRef.current[i]?.selected ?? true]));
    for (const i of indices) pendingFileToggles.current.set(i, wanted);
    setFiles((prev) => prev.map((f, i) => (idxSet.has(i) ? { ...f, selected: wanted } : f)));
    try {
      const res = await setTorrentFilesWanted(id, wanted ? indices : [], wanted ? [] : indices);
      for (const i of indices) pendingFileToggles.current.delete(i);
      if (res.ok && res.files) setFiles(overlayPendingToggles(res.files));
    } catch {
      for (const i of indices) pendingFileToggles.current.delete(i);
      setFiles((prev) => prev.map((f, i) => (idxSet.has(i) ? { ...f, selected: prior.get(i)! } : f)));
    }
  }, [id, overlayPendingToggles]);

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

  const handleRemove = useCallback(async (deleteFiles: boolean) => {
    setActionLoading(true);
    try {
      await removeTorrent(id, deleteFiles);
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
    setSwapTarget(magnetUri);
  }, []);

  const confirmSwap = useCallback(async () => {
    const magnetUri = swapTarget;
    if (!magnetUri) return;
    setSwapTarget(null);
    setActionLoading(true);
    try {
      // Chosen release first, then the rest as auto-advance fallbacks.
      const rest = alternatives.map((a) => a.magnetUri).filter((u) => u !== magnetUri);
      const res = await swapTorrent(id, [magnetUri, ...rest]);
      router.push(`/torrents/${res.torrent.id}`);
    } catch (err) {
      setAltError((err as Error).message);
      setActionLoading(false);
    }
  }, [id, router, alternatives, swapTarget]);

  const handleFetchSubtitles = useCallback(async () => {
    setSubtitleError(null);
    try {
      await fetchTorrentSubtitles(id);
      fetchData();
    } catch (err) {
      setSubtitleError((err as Error).message);
    }
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
  const isStopped = torrent.status === "paused" || torrent.status === "completed";
  const isStalled = !!torrent.stalledSince;
  const canPauseResume = ["downloading", "seeding", "paused", "completed"].includes(torrent.status);

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-6 animate-card-enter">
      <PageHeader
        backHref="/"
        actions={
          <>
            {canPauseResume && (
              <Button variant="outline" size="sm" onClick={isStopped ? handleResume : handlePause} disabled={actionLoading}>
                {torrent.status === "completed" ? "Seed" : isStopped ? "Resume" : "Pause"}
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setShowRemove(true)} disabled={actionLoading}>Remove</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More actions"><DotsThree weight="bold" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleVerify} disabled={actionLoading}>Verify</DropdownMenuItem>
                <DropdownMenuItem onClick={handleReannounce} disabled={actionLoading}>Update trackers</DropdownMenuItem>
                <DropdownMenuItem onClick={handleFindAlternatives} disabled={altSearching}>Find alternatives</DropdownMenuItem>
                {torrent.magnetUri && (
                  <DropdownMenuItem onClick={() => navigator.clipboard.writeText(torrent.magnetUri!).catch(() => {})}>
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
          <p className="font-medium">Stalled &mdash; {torrent.numPeers === 0 ? "no peers available" : "not receiving data"}</p>
          <p className="text-xs opacity-80">
            {torrent.numPeers === 0 ? "This torrent isn't finding peers." : "Peers are connected but nothing is arriving."}
            {" "}Try updating trackers, or swap to a healthier release.
          </p>
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

      <Section
        title="Files"
        count={files.length}
        action={
          fileSelection && (
            // -my-1 keeps the h-6 buttons from growing the header row, so the
            // list below never shifts when the selection actions appear.
            <div className="-my-1 flex shrink-0 items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground tabular-nums">
                {fileSelection.count} files · {formatBytes(fileSelection.size)}
              </span>
              <Button size="xs" variant="secondary" onClick={() => handleSetWanted(fileSelection.indices, true)}>
                Download
              </Button>
              <Button size="xs" variant="ghost" onClick={() => handleSetWanted(fileSelection.indices, false)}>
                Skip
              </Button>
              <Button size="icon-xs" variant="ghost" aria-label="Clear selection" onClick={fileSelection.clear}>
                <X />
              </Button>
            </div>
          )
        }
      >
        <FileList
          files={files}
          onSetWanted={handleSetWanted}
          downloading={torrent.status === "downloading"}
          stalled={isStalled}
          pollPausedRef={filePollPausedRef}
          onSelectionChange={setFileSelection}
        />
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
        {subtitleError && <Callout tone="error" className="mb-3">{subtitleError}</Callout>}
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

      <RemoveTorrentDialog
        open={showRemove}
        torrentName={torrent.name}
        onClose={() => setShowRemove(false)}
        onConfirm={handleRemove}
      />

      <ConfirmDialog
        open={swapTarget !== null}
        title="Swap release"
        message="Swap in this release? The current torrent and its partial files will be removed."
        confirmLabel="Swap"
        destructive
        busyLabel="Swapping…"
        onConfirm={confirmSwap}
        onClose={() => setSwapTarget(null)}
      />
    </div>
  );
}
