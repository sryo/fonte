"use client";

import { useState } from "react";
import { addWatchlistEntry, type MediaType } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MEDIA_TYPES: { value: MediaType; label: string }[] = [
  { value: "movie", label: "Movie" },
  { value: "tv", label: "TV Show" },
  { value: "music", label: "Music" },
  { value: "game", label: "Game" },
  { value: "book", label: "Book" },
  { value: "app", label: "App" },
  { value: "other", label: "Other" },
];

// Per-type quality vocabulary; "any" maps to an empty quality (no filter).
const QUALITY_OPTIONS: Record<MediaType, string[]> = {
  movie: ["720p", "1080p", "4K"],
  tv: ["720p", "1080p", "4K"],
  music: ["FLAC", "320", "V0", "any"],
  game: ["any"],
  book: ["EPUB", "PDF", "any"],
  app: ["any"],
  other: ["any"],
};
const DEFAULT_QUALITY: Record<MediaType, string> = {
  movie: "1080p",
  tv: "1080p",
  music: "FLAC",
  game: "any",
  book: "EPUB",
  app: "any",
  other: "any",
};

export function AddWatchlistModal({ open, onClose, onAdded }: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [wlForm, setWlForm] = useState({ title: "", mediaType: "movie" as MediaType, year: "", quality: "1080p", seasonPattern: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTv = wlForm.mediaType === "tv";

  const handleAdd = async () => {
    if (!wlForm.title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await addWatchlistEntry({
        title: wlForm.title.trim(),
        mediaType: wlForm.mediaType,
        year: wlForm.year ? parseInt(wlForm.year) : undefined,
        quality: wlForm.quality === "any" ? "" : wlForm.quality,
        seasonPattern: isTv ? wlForm.seasonPattern.trim() || undefined : undefined,
      });
      setWlForm({ title: "", mediaType: "movie", year: "", quality: "1080p", seasonPattern: "" });
      onClose();
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add to Watchlist" onSubmit={handleAdd}>
      <div className="space-y-4">
        <Input
          placeholder="Title"
          value={wlForm.title}
          onChange={(e) => setWlForm({ ...wlForm, title: e.target.value })}
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            value={wlForm.mediaType}
            onValueChange={(v) =>
              setWlForm({ ...wlForm, mediaType: v as MediaType, quality: DEFAULT_QUALITY[v as MediaType] })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEDIA_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder={isTv ? "First aired (optional)" : "Year"}
            title={isTv ? "Only used to find the right poster" : undefined}
            type="number"
            value={wlForm.year}
            onChange={(e) => setWlForm({ ...wlForm, year: e.target.value })}
          />
        </div>
        {isTv && (
          <div className="space-y-1">
            <Input
              placeholder="Season (S14, S14E02)"
              value={wlForm.seasonPattern}
              onChange={(e) => setWlForm({ ...wlForm, seasonPattern: e.target.value })}
            />
            <p className="text-2xs text-muted-foreground">
              Empty keeps grabbing new episodes; a season fulfills once.
            </p>
          </div>
        )}
        <Select
          value={wlForm.quality}
          onValueChange={(v) => setWlForm({ ...wlForm, quality: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUALITY_OPTIONS[wlForm.mediaType].map((q) => (
              <SelectItem key={q} value={q}>
                {q === "any" ? "Any quality" : q}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} className="text-muted-foreground">
            Cancel
            <Kbd className="hidden sm:inline-flex">Esc</Kbd>
          </Button>
          <Button
            type="submit"
            disabled={!wlForm.title.trim() || submitting}
            className="flex-1 bg-watchlist text-watchlist-foreground hover:bg-watchlist/90"
          >
            {submitting ? "Adding..." : "Add"}
            {!submitting && <Kbd className="hidden sm:inline-flex bg-current/15 text-inherit">↵</Kbd>}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
