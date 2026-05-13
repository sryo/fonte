"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { addTorrent, sendMessage } from "@/lib/api";

/* ---------- Types ---------- */

interface SearchResult {
  title: string;
  magnetUri: string;
  seeders?: number;
  size?: number;
}

interface TopBarProps {
  onOpenChat: () => void;
}

/* ---------- Nav items ---------- */

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: House, exact: true },
  { href: "/control", label: "Control", icon: SlidersHorizontal, exact: false },
  { href: "/settings", label: "Settings", icon: Gear, exact: false },
] as const;

/* ---------- Helpers ---------- */

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* ---------- TopBar component ---------- */

export function TopBar({ onOpenChat }: TopBarProps) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Smart-bar state
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);

  /* ---- Hydration guard ---- */
  useEffect(() => setMounted(true), []);

  /* ---- Cmd+K global shortcut ---- */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* ---- Dismiss results on outside click ---- */
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        searchWrapperRef.current &&
        !searchWrapperRef.current.contains(e.target as Node)
      ) {
        setResults([]);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  /* ---- Auto-dismiss toast ---- */
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

  /* ---- Submit handler (magnet / hash / IMDB / agent) ---- */
  const handleSubmit = async () => {
    const value = input.trim();
    if (!value || loading) return;

    setLoading(true);
    setResults([]);

    try {
      // 1. Magnet link
      if (value.startsWith("magnet:")) {
        await addTorrent({ magnetUri: value });
        showToast("Torrent added");
        setInput("");
        return;
      }

      // 2. 40-char hex info hash
      if (/^[a-fA-F0-9]{40}$/.test(value)) {
        await addTorrent({ magnetUri: `magnet:?xt=urn:btih:${value}` });
        showToast("Torrent added");
        setInput("");
        return;
      }

      // 3. IMDB URL pattern
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

      // 4. Natural language / agent message
      await sendMessage({
        message: value,
        agent: "aitorrent",
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

  /* ---- Add a search result ---- */
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

  /* ---- Render ---- */
  return (
    <header className="border-b bg-card shrink-0">
      <div className="max-w-6xl mx-auto flex items-center gap-3 px-4 py-2">
      {/* ===== Left: Nav buttons ===== */}
      <nav className="flex items-center gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact
            ? pathname === href
            : pathname === href || pathname.startsWith(href + "/");

          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              title={label}
              className={cn(
                "h-9 w-9 rounded-lg flex items-center justify-center transition-colors",
                active
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <Icon className="h-[18px] w-[18px]" weight={active ? "fill" : "bold"} />
            </Link>
          );
        })}
      </nav>

      {/* ===== Center: Search input ===== */}
      <div className="flex-1 relative" ref={searchWrapperRef}>
        {/* Input wrapper */}
        <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30 transition-all">
          {/* Left icon */}
          {loading ? (
            <SpinnerGap className="h-[18px] w-[18px] text-muted-foreground animate-spin shrink-0" />
          ) : (
            <MagnifyingGlass className="h-[18px] w-[18px] text-muted-foreground shrink-0" weight="bold" />
          )}

          {/* Input */}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            placeholder="Search, paste a magnet link, or ask anything... (⌘K)"
            disabled={loading}
            className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-muted-foreground disabled:opacity-60"
          />

          {/* Submit button */}
          {input.trim() && (
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center justify-center h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
              aria-label="Submit"
            >
              <PaperPlaneTilt className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div
            className={cn(
              "absolute right-3 -bottom-8 z-30 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shadow-md transition-all animate-in fade-in slide-in-from-top-1 duration-200",
              toast.type === "success"
                ? "bg-emerald-500/90 text-white"
                : "bg-destructive/90 text-destructive-foreground"
            )}
          >
            {toast.type === "success" && <Check className="h-3 w-3" />}
            {toast.message}
          </div>
        )}

        {/* Search results dropdown */}
        {results.length > 0 && (
          <div className="absolute w-full bg-card rounded-xl border shadow-lg mt-1 max-h-64 overflow-y-auto z-40">
            {results.map((result, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors border-b last:border-b-0"
              >
                {/* Title */}
                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium truncate"
                    title={result.title}
                  >
                    {result.title}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    {result.seeders !== undefined && (
                      <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
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

                {/* Add button */}
                <button
                  onClick={() => handleAddResult(result)}
                  className="flex items-center gap-1.5 shrink-0 rounded-lg bg-primary/10 text-primary px-3 py-1.5 text-xs font-medium hover:bg-primary/20 transition-colors"
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

      {/* ===== Right: Theme toggle + Chat button ===== */}
      <div className="flex items-center gap-1">
        {/* Theme toggle */}
        <button
          onClick={() =>
            setTheme(resolvedTheme === "dark" ? "light" : "dark")
          }
          className="h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
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

        {/* Chat button */}
        <button
          onClick={onOpenChat}
          className="h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Open chat"
        >
          <Robot className="h-[18px] w-[18px]" weight="bold" />
        </button>
      </div>
      </div>
    </header>
  );
}
