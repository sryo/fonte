"use client";

import { useState } from "react";
import { addWatchlistEntry, type MediaType } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const QUALITIES = ["720p", "1080p", "4K"];

export function AddWatchlistModal({ open, onClose, onAdded }: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [wlForm, setWlForm] = useState({ title: "", mediaType: "movie" as MediaType, year: "", quality: "1080p" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!wlForm.title.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await addWatchlistEntry({
        title: wlForm.title.trim(),
        mediaType: wlForm.mediaType,
        year: wlForm.year ? parseInt(wlForm.year) : undefined,
        quality: wlForm.quality,
      });
      setWlForm({ title: "", mediaType: "movie", year: "", quality: "1080p" });
      onClose();
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add to Watchlist">
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
            onValueChange={(v) => setWlForm({ ...wlForm, mediaType: v as MediaType })}
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
            placeholder="Year"
            type="number"
            value={wlForm.year}
            onChange={(e) => setWlForm({ ...wlForm, year: e.target.value })}
          />
        </div>
        <Select
          value={wlForm.quality}
          onValueChange={(v) => setWlForm({ ...wlForm, quality: v })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUALITIES.map((q) => (
              <SelectItem key={q} value={q}>
                {q}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button
            onClick={handleAdd}
            disabled={!wlForm.title.trim() || submitting}
            className="flex-1 bg-watchlist text-watchlist-foreground hover:bg-watchlist/90"
          >
            {submitting ? "Adding..." : "Add"}
          </Button>
          <Button variant="ghost" onClick={onClose} className="text-muted-foreground">
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
