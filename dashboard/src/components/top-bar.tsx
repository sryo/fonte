"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import {
  House,
  SlidersHorizontal,
  Gear,
  Sun,
  Moon,
  Robot,
  MagnifyingGlass,
  PaperPlaneTilt,
  Plus,
  Check,
  SpinnerGap,
} from "@phosphor-icons/react";
import { addTorrent, sendMessage, getTorrents, getWatchlist } from "@/lib/api";
import { StatusBadge } from "@/components/ui/status-badge";
import { Kbd } from "@/components/ui/kbd";
import { MiddleTruncate } from "@/components/ui/middle-truncate";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/format";
import { useHotkey } from "@/components/hotkeys-provider";
import { useIsMac, modKeyLabel } from "@/hooks/use-platform";

interface SearchResult {
  title: string;
  magnetUri: string;
  seeders?: number;
  size?: number;
}

/** A loaded torrent or watchlist entry the search box can jump to directly. */
interface JumpItem {
  type: "torrent" | "watchlist";
  id: string;
  title: string;
  status: string;
}

interface TopBarProps {
  onOpenChat: () => void;
}

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: House, exact: true, seq: "g h" },
  { href: "/control", label: "Control", icon: SlidersHorizontal, exact: false, seq: "g c" },
  { href: "/settings", label: "Settings", icon: Gear, exact: false, seq: "g s" },
] as const;

export function TopBar({ onOpenChat }: TopBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const isMac = useIsMac();

  // Smart-bar state
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [jumpPool, setJumpPool] = useState<JumpItem[] | null>(null);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [selIdx, setSelIdx] = useState(-1);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useHotkey({
    id: "focus-search",
    keys: "mod+k",
    description: "Focus the search bar",
    allowInInput: true,
    handler: () => inputRef.current?.focus(),
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        searchWrapperRef.current &&
        !searchWrapperRef.current.contains(e.target as Node)
      ) {
        setResults([]);
        setJumpOpen(false);
        setSelIdx(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  const showToast = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      setToast({ message, type });
    },
    []
  );

  const ensureJumpPool = useCallback(async () => {
    if (jumpPool) return;
    try {
      const [t, w] = await Promise.all([getTorrents(), getWatchlist()]);
      setJumpPool([
        ...(t.torrents ?? [])
          .filter((x) => x.status !== "removed")
          .map((x) => ({ type: "torrent" as const, id: x.id, title: x.name || x.infoHash, status: x.status })),
        ...(w.entries ?? []).map((x) => ({ type: "watchlist" as const, id: x.id, title: x.title, status: x.status })),
      ]);
    } catch {
      setJumpPool([]);
    }
  }, [jumpPool]);

  const jumpMatches = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (q.length < 2 || q.startsWith("magnet:") || /^[a-f0-9]{40}$/i.test(q) || !jumpPool) return [];
    return jumpPool.filter((item) => item.title.toLowerCase().includes(q)).slice(0, 6);
  }, [input, jumpPool]);

  const jumpTo = useCallback(
    (item: JumpItem) => {
      router.push(item.type === "torrent" ? `/torrents/${item.id}` : `/watchlist/${item.id}`);
      setInput("");
      setResults([]);
      setJumpPool(null);
      setJumpOpen(false);
      setSelIdx(-1);
      inputRef.current?.blur();
    },
    [router]
  );

  const handleSubmit = async () => {
    const value = input.trim();
    if (!value || loading) return;

    setLoading(true);
    setResults([]);

    try {
      if (value.startsWith("magnet:")) {
        await addTorrent({ magnetUri: value });
        showToast("Torrent added");
        setInput("");
        return;
      }

      if (/^[a-fA-F0-9]{40}$/.test(value)) {
        await addTorrent({ magnetUri: `magnet:?xt=urn:btih:${value}` });
        showToast("Torrent added");
        setInput("");
        return;
      }

      if (/tt\d{7,}/.test(value)) {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: value }),
        });
        if (res.ok) {
          const data = await res.json();
          setResults(data.results ?? []);
        } else {
          showToast("Search failed", "error");
        }
        return;
      }

      await sendMessage({
        message: value,
        agent: "fonte",
        channel: "web",
        sender: "Web",
      });
      showToast("Message sent to agent");
      setInput("");
      onOpenChat();
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleAddResult = async (result: SearchResult) => {
    try {
      await addTorrent({ magnetUri: result.magnetUri });
      showToast("Torrent added");
      setResults((prev) =>
        prev.filter((r) => r.magnetUri !== result.magnetUri)
      );
    } catch (err) {
      showToast((err as Error).message, "error");
    }
  };

  return (
    <header className="border-b bg-card shrink-0">
      <div className="max-w-(--content-max-w) mx-auto flex items-center gap-3 px-4 py-2">
      <nav className="flex items-center gap-1">
        <TooltipProvider>
          {NAV_ITEMS.map(({ href, label, icon: Icon, exact, seq }) => {
            const active = exact
              ? pathname === href
              : pathname === href || pathname.startsWith(href + "/");

            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    aria-label={label}
                    className={cn(
                      "h-9 w-9 rounded-md flex items-center justify-center transition-colors",
                      active
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" weight={active ? "fill" : "bold"} />
                  </Link>
                </TooltipTrigger>
                <TooltipContent className="flex items-center gap-1.5">
                  {label}
                  {seq.split(" ").map((k) => (
                    <Kbd key={k} className="bg-background/20 text-background">
                      {k.toUpperCase()}
                    </Kbd>
                  ))}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </TooltipProvider>
      </nav>

      <div className="flex-1 relative" ref={searchWrapperRef}>
        <div className="flex items-center gap-2 rounded-md border bg-background h-9 px-3 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all">
          {loading ? (
            <SpinnerGap className="h-[18px] w-[18px] text-muted-foreground animate-spin shrink-0" />
          ) : (
            <MagnifyingGlass className="h-[18px] w-[18px] text-muted-foreground shrink-0" weight="bold" />
          )}

          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              const v = e.target.value;
              setInput(v);
              setSelIdx(-1);
              if (v.trim().length >= 2) {
                ensureJumpPool();
                setJumpOpen(true);
              } else {
                setJumpOpen(false);
                if (!v.trim()) setJumpPool(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && jumpOpen && jumpMatches.length) {
                e.preventDefault();
                setSelIdx((i) => Math.min(i + 1, jumpMatches.length - 1));
              } else if (e.key === "ArrowUp" && jumpOpen && jumpMatches.length) {
                e.preventDefault();
                setSelIdx((i) => Math.max(i - 1, -1));
              } else if (e.key === "Escape") {
                setResults([]);
                setJumpOpen(false);
                setSelIdx(-1);
              } else if (e.key === "Enter") {
                if (selIdx >= 0 && jumpMatches[selIdx]) jumpTo(jumpMatches[selIdx]);
                else handleSubmit();
              }
            }}
            placeholder="Search, paste a magnet link, or ask anything…"
            disabled={loading}
            className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground disabled:opacity-60"
          />

          {/* Shortcut hint — swaps for the submit button once there's input */}
          {!input.trim() && (
            <Kbd className="hidden sm:inline-flex">{modKeyLabel(isMac)}K</Kbd>
          )}

          {input.trim() && (
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
              aria-label="Submit"
            >
              <PaperPlaneTilt className="h-4 w-4" />
            </button>
          )}
        </div>

        {toast && (
          <div
            className={cn(
              "absolute right-3 -bottom-8 z-30 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shadow-md transition-all animate-in fade-in slide-in-from-top-1 duration-200",
              toast.type === "success"
                ? "bg-done/90 text-white"
                : "bg-destructive/90 text-destructive-foreground"
            )}
          >
            {toast.type === "success" && <Check className="h-3 w-3" />}
            {toast.message}
          </div>
        )}

        {((jumpOpen && jumpMatches.length > 0) || results.length > 0) && (
          <div className="absolute w-full bg-card rounded-xl shadow-card mt-1 max-h-72 overflow-y-auto z-40">
            {jumpOpen && jumpMatches.length > 0 && (
              <div className="border-b last:border-b-0">
                <p className="px-4 pt-2 pb-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  Jump to
                </p>
                {jumpMatches.map((item, idx) => (
                  <button
                    key={`${item.type}-${item.id}`}
                    onClick={() => jumpTo(item)}
                    onMouseEnter={() => setSelIdx(idx)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
                      idx === selIdx && "bg-muted/50"
                    )}
                  >
                    <MiddleTruncate text={item.title} className="min-w-0 flex-1 text-sm font-medium" />
                    <StatusBadge status={item.status} />
                  </button>
                ))}
              </div>
            )}
            {results.map((result, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors border-b last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <MiddleTruncate text={result.title} className="text-sm font-medium" />
                  <div className="flex items-center gap-2 mt-0.5">
                    {result.seeders !== undefined && (
                      <span className="inline-flex items-center rounded-full bg-done/10 px-2 py-0.5 text-xs font-medium text-done">
                        {result.seeders} seeders
                      </span>
                    )}
                    {result.size !== undefined && result.size > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(result.size)}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleAddResult(result)}
                  className="flex items-center gap-1.5 shrink-0 rounded-md bg-primary/10 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/20 transition-colors"
                  aria-label={`Add ${result.title}`}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() =>
            setTheme(resolvedTheme === "dark" ? "light" : "dark")
          }
          className="h-9 w-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label={
            mounted && resolvedTheme === "dark" ? "Light mode" : "Dark mode"
          }
        >
          {mounted && resolvedTheme === "dark" ? (
            <Sun className="h-[18px] w-[18px]" weight="bold" />
          ) : (
            <Moon className="h-[18px] w-[18px]" weight="bold" />
          )}
        </button>

        <button
          onClick={onOpenChat}
          className="h-9 w-9 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Open chat"
        >
          <Robot className="h-[18px] w-[18px]" weight="bold" />
        </button>
      </div>
      </div>
    </header>
  );
}
