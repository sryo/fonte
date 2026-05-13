"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  getTorrents,
  getWatchlist,
  getAutomations,
  getTorrentStats,
} from "@/lib/api";
import type {
  TorrentRecord,
  WatchlistRecord,
  AutomationRule,
  TorrentStats,
} from "@/lib/api";
import { formatBytes, formatSpeed, formatRatio } from "@/lib/format";
import {
  DownloadSimple,
  Eye,
  Lightning,
  Check,
  FilmStrip,
  CaretRight,
  Television,
} from "@phosphor-icons/react";

// ── Filter types ─────────────────────────────────────────────────────────

type FilterChip = "all" | "downloading" | "completed" | "watching";

const FILTER_CHIPS: { key: FilterChip; label: string }[] = [
  { key: "all", label: "All" },
  { key: "downloading", label: "Downloading" },
  { key: "completed", label: "Completed" },
  { key: "watching", label: "Watching" },
];

// ── Helpers ──────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Progress Ring ────────────────────────────────────────────────────────

function ProgressRing({ progress, size = 48 }: { progress: number; size?: number }) {
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/30"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-torrent transition-all duration-500"
        />
      </svg>
      <span className="text-[10px] font-semibold tabular-nums">
        {Math.round(progress * 100) / 100 >= 100 ? "100" : (progress).toFixed(0)}%
      </span>
    </div>
  );
}

// ── Status Badge ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    downloading: "bg-torrent/15 text-torrent",
    seeding: "bg-green-500/15 text-green-600 dark:text-green-400",
    completed: "bg-green-500/15 text-green-600 dark:text-green-400",
    paused: "bg-muted text-muted-foreground",
    error: "bg-destructive/15 text-destructive",
    watching: "bg-watchlist/15 text-watchlist",
    fulfilled: "bg-green-500/15 text-green-600 dark:text-green-400",
  };

  return (
    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-md capitalize", styles[status] ?? "bg-muted text-muted-foreground")}>
      {status}
    </span>
  );
}

// ── Content Row ──────────────────────────────────────────────────────────

function ContentRow({
  title,
  count,
  icon: Icon,
  children,
  emptyMessage,
  isEmpty,
}: {
  title: string;
  count: number;
  icon: React.ElementType;
  children: React.ReactNode;
  emptyMessage: string;
  isEmpty: boolean;
}) {
  return (
    <section className="space-y-3 animate-card-enter">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Icon className="h-5 w-5 text-muted-foreground" weight="duotone" />
          {title}
          {count > 0 && (
            <span className="text-sm font-normal text-muted-foreground">({count})</span>
          )}
        </h2>
      </div>
      {isEmpty ? (
        <p className="text-sm text-muted-foreground py-6 text-center">{emptyMessage}</p>
      ) : (
        <div className="flex flex-wrap gap-3">{children}</div>
      )}
    </section>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterChip>("all");

  const [torrents, setTorrents] = useState<TorrentRecord[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistRecord[]>([]);
  const [automations, setAutomations] = useState<AutomationRule[]>([]);
  const [stats, setStats] = useState<TorrentStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [torrentsRes, watchlistRes, automationsRes, statsRes] = await Promise.all([
        getTorrents(),
        getWatchlist(),
        getAutomations(),
        getTorrentStats(),
      ]);
      setTorrents(torrentsRes.torrents);
      setWatchlist(watchlistRes.entries);
      setAutomations(automationsRes.rules);
      setStats(statsRes);
    } catch {
      /* silently ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 3000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // ── Derived data ───────────────────────────────────────────────────────

  const activeTorrents = torrents.filter(
    (t) => t.status === "downloading" || t.status === "seeding"
  );

  const completedTorrents = torrents
    .filter((t) => t.status === "completed")
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, 10);

  const watchingEntries = watchlist.filter((w) => w.status === "watching");

  const enabledAutomations = automations.filter((a) => a.enabled);

  // ── Visibility based on filter ─────────────────────────────────────────

  const showDownloading = filter === "all" || filter === "downloading";
  const showCompleted = filter === "all" || filter === "completed";
  const showWatching = filter === "all" || filter === "watching";
  const showAutomations = filter === "all";

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-6 space-y-8">
      {/* Quick filter chips */}
      <div className="flex items-center gap-2 flex-wrap" role="tablist">
        {FILTER_CHIPS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              filter === key
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Row 1: Active Downloads */}
      {showDownloading && (
        <ContentRow
          title="Active Downloads"
          count={activeTorrents.length}
          icon={DownloadSimple}
          emptyMessage="No active downloads"
          isEmpty={activeTorrents.length === 0}
        >
          {activeTorrents.map((torrent) => (
            <button
              key={torrent.id}
              onClick={() => router.push(`/torrents/${torrent.id}`)}
              className="w-56 rounded-xl shadow-sm border bg-card p-4 text-left hover:bg-accent/50 transition-colors group cursor-pointer"
            >
              <div className="flex items-start gap-3">
                <ProgressRing progress={torrent.progress * 100} />
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-foreground">
                    {torrent.name}
                  </p>
                  <StatusBadge status={torrent.status} />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="text-torrent">&#8595; {formatSpeed(torrent.downloadSpeed)}</span>
                <span>&bull;</span>
                <span>{torrent.numPeers} peers</span>
              </div>
            </button>
          ))}
        </ContentRow>
      )}

      {/* Row 2: Watchlist */}
      {showWatching && (
        <ContentRow
          title="Watchlist"
          count={watchingEntries.length}
          icon={Eye}
          emptyMessage="Nothing on your watchlist"
          isEmpty={watchingEntries.length === 0}
        >
          {watchingEntries.map((entry) => (
            <button
              key={entry.id}
              onClick={() => router.push(`/watchlist/${entry.id}`)}
              className="w-48 rounded-xl shadow-sm border bg-card overflow-hidden text-left hover:bg-accent/50 transition-colors group cursor-pointer"
            >
              {/* Colored header */}
              <div className="h-20 bg-watchlist/10 flex items-center justify-center">
                {entry.mediaType === "tv" ? (
                  <Television className="h-8 w-8 text-watchlist/60" weight="duotone" />
                ) : (
                  <FilmStrip className="h-8 w-8 text-watchlist/60" weight="duotone" />
                )}
              </div>
              {/* Content */}
              <div className="p-3 space-y-1.5">
                <p className="text-sm font-medium leading-tight line-clamp-1 group-hover:text-foreground">
                  {entry.title}
                </p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {entry.year && (
                    <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-md text-muted-foreground">
                      {entry.year}
                    </span>
                  )}
                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-md text-muted-foreground">
                    {entry.quality}
                  </span>
                  <StatusBadge status={entry.status} />
                </div>
              </div>
            </button>
          ))}
        </ContentRow>
      )}

      {/* Row 3: Recently Completed */}
      {showCompleted && (
        <ContentRow
          title="Recently Completed"
          count={completedTorrents.length}
          icon={Check}
          emptyMessage="No completed downloads yet"
          isEmpty={completedTorrents.length === 0}
        >
          {completedTorrents.map((torrent) => (
            <button
              key={torrent.id}
              onClick={() => router.push(`/torrents/${torrent.id}`)}
              className="w-56 rounded-xl shadow-sm border bg-card p-4 text-left hover:bg-accent/50 transition-colors group cursor-pointer"
            >
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 h-5 w-5 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
                  <Check className="h-3 w-3 text-green-600 dark:text-green-400" weight="bold" />
                </div>
                <p className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-foreground">
                  {torrent.name}
                </p>
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{formatBytes(torrent.size)}</span>
                {torrent.completedAt && (
                  <>
                    <span>&bull;</span>
                    <span>{relativeTime(torrent.completedAt)}</span>
                  </>
                )}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Ratio: {formatRatio(torrent.uploaded, torrent.downloaded)}
              </div>
            </button>
          ))}
        </ContentRow>
      )}

      {/* Row 4: Automations */}
      {showAutomations && (
        <ContentRow
          title="Automations"
          count={enabledAutomations.length}
          icon={Lightning}
          emptyMessage="No automations configured"
          isEmpty={enabledAutomations.length === 0}
        >
          {enabledAutomations.map((rule) => (
            <div
              key={rule.id}
              className="w-56 rounded-xl shadow-sm border bg-card p-4 border-t-3 border-t-automation"
            >
              <p className="text-sm font-medium leading-tight line-clamp-1">{rule.name}</p>
              <div className="mt-2 flex items-center gap-1.5 text-[10px]">
                <span className="bg-automation/15 text-automation px-1.5 py-0.5 rounded-md">
                  {rule.triggerType.replace(":", " ")}
                </span>
                <CaretRight className="h-3 w-3 text-muted-foreground" />
                {rule.actions.slice(0, 1).map((action, i) => (
                  <span key={i} className="bg-muted px-1.5 py-0.5 rounded-md text-muted-foreground">
                    {action.type.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Triggered {rule.triggerCount} time{rule.triggerCount !== 1 ? "s" : ""}
              </p>
            </div>
          ))}
        </ContentRow>
      )}
    </div>
  );
}
